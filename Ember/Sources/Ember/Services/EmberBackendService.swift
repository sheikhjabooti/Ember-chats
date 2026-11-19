import Foundation

/// Talks to the Ember Server backend (see the sibling `EmberServer`
/// project) over REST for persisted chats and a WebSocket for real-time
/// delivery. This is the default `ChatBackendServicing` implementation —
/// `FirebaseChatService` remains available if you'd rather run on
/// Firebase instead; both conform to the same protocol so swapping is a
/// one-line change in `EmberApp.swift`.
public actor EmberBackendService: NSObject, ChatBackendServicing {

    private let baseURL: URL
    private let session: URLSession
    private var authToken: String?
    private var currentUserIDCache: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private var breakoutContinuations: [String: AsyncStream<Message>.Continuation] = [:]
    private var messageListeners: [(chatID: String, message: Message) -> Void] = []

    /// - Parameter baseURL: e.g. `https://ember.yourdomain.com` in
    ///   production, or `http://localhost:4000` for local development
    ///   against `EmberServer` running with `npm run dev`.
    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: - Auth

    public func signIn(email: String, password: String) async throws -> String {
        let body = ["email": email, "password": password]
        let response: AuthResponse = try await post("/auth/login", body: body, authorized: false)
        authToken = response.token
        currentUserIDCache = response.user.id
        return response.user.id
    }

    public func register(email: String, password: String, displayName: String) async throws -> String {
        let body = ["email": email, "password": password, "displayName": displayName]
        let response: AuthResponse = try await post("/auth/register", body: body, authorized: false)
        authToken = response.token
        currentUserIDCache = response.user.id
        return response.user.id
    }

    public func currentUserID() async -> String? {
        currentUserIDCache
    }

    // MARK: - Persisted chats

    public func fetchChats(for userID: String) async throws -> [Chat] {
        try await get("/chats")
    }

    public func fetchMessages(chatID: String, before: Date?, limit: Int) async throws -> [Message] {
        var path = "/chats/\(chatID)/messages?limit=\(limit)"
        if let before {
            path += "&before=\(ISO8601DateFormatter().string(from: before))"
        }
        return try await get(path)
    }

    public func sendMessage(_ message: Message) async throws {
        struct Body: Encodable { let text: String?; let replyToMessageId: String? }
        let _: Message = try await post(
            "/chats/\(message.chatID)/messages",
            body: Body(text: message.text, replyToMessageId: message.replyToMessageID)
        )
    }

    public func createChat(_ chat: Chat) async throws -> Chat {
        struct Body: Encodable { let kind: String; let title: String?; let participantIds: [String] }
        return try await post(
            "/chats",
            body: Body(kind: chat.kind.rawValue, title: chat.title, participantIds: chat.participantIDs)
        )
    }

    public func updateChat(_ chat: Chat) async throws {
        // No PATCH /chats/:id endpoint yet server-side for title/avatar
        // edits — see EmberServer README "What's still a stub".
    }

    // MARK: - Presence

    public func setTyping(chatID: String, userID: String, isTyping: Bool) async throws {
        struct Body: Encodable { let isTyping: Bool }
        try await postNoContent("/chats/\(chatID)/typing", body: Body(isTyping: isTyping))
    }

    public func setPresence(userID: String, isOnline: Bool) async throws {
        // Presence is currently derived from WebSocket connection state
        // server-side rather than an explicit endpoint.
    }

    // MARK: - Breakout / volatile channel

    public func streamBreakoutMessages(chatID: String) -> AsyncStream<Message> {
        AsyncStream { continuation in
            Task { await self.registerBreakoutStream(chatID: chatID, continuation: continuation) }
            continuation.onTermination = { _ in
                Task { await self.unregisterBreakoutStream(chatID: chatID) }
            }
        }
    }

    private func registerBreakoutStream(chatID: String, continuation: AsyncStream<Message>.Continuation) async {
        breakoutContinuations[chatID] = continuation
        await ensureWebSocketConnected()
        await sendWSFrame(["type": "breakout:subscribe", "chatId": chatID])
    }

    private func unregisterBreakoutStream(chatID: String) async {
        breakoutContinuations.removeValue(forKey: chatID)
        await sendWSFrame(["type": "breakout:unsubscribe", "chatId": chatID])
    }

    public func publishBreakoutMessage(_ message: Message, chatID: String) async throws {
        await ensureWebSocketConnected()
        await sendWSFrame(["type": "breakout:send", "chatId": chatID, "text": message.text ?? ""])
    }

    public func notifyBreakoutStarted(parentChatID: String, participantIDs: [String]) async throws -> String {
        struct Body: Encodable { let participantIds: [String] }
        let response: BreakoutStartedResponse = try await post(
            "/chats/\(parentChatID)/breakout",
            body: Body(participantIds: participantIDs)
        )
        return response.id
    }

    public func promoteBreakout(chatID: String) async throws {
        struct EmptyBody: Encodable {}
        let _: PromoteResponse = try await post("/breakouts/\(chatID)/keep", body: EmptyBody())
    }

    public func endBreakout(chatID: String) async throws {
        struct EmptyBody: Encodable {}
        try await postNoContent("/breakouts/\(chatID)/end", body: EmptyBody())
    }

    // MARK: - REST plumbing

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "GET"
        applyAuth(&request)
        return try await send(request)
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body, authorized: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.emberEncoder.encode(body)
        if authorized { applyAuth(&request) }
        return try await send(request)
    }

    private func postNoContent<Body: Encodable>(_ path: String, body: Body) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.emberEncoder.encode(body)
        applyAuth(&request)
        _ = try await session.data(for: request)
    }

    private func applyAuth(_ request: inout URLRequest) {
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw EmberBackendError.server(message)
        }
        return try JSONDecoder.emberDecoder.decode(T.self, from: data)
    }

    // MARK: - WebSocket plumbing

    private func ensureWebSocketConnected() async {
        guard webSocketTask == nil, let authToken else { return }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws"
        components.queryItems = [URLQueryItem(name: "token", value: authToken)]

        let task = session.webSocketTask(with: components.url!)
        webSocketTask = task
        task.resume()
        listenForWebSocketMessages(task)
    }

    private func sendWSFrame(_ payload: [String: Any]) async {
        guard let task = webSocketTask,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        try? await task.send(.string(text))
    }

    private func listenForWebSocketMessages(_ task: URLSessionWebSocketTask) {
        Task {
            while true {
                do {
                    let message = try await task.receive()
                    if case .string(let text) = message, let data = text.data(using: .utf8) {
                        await self.handleWebSocketFrame(data)
                    }
                } catch {
                    await self.handleWebSocketDisconnect()
                    break
                }
            }
        }
    }

    private func handleWebSocketDisconnect() {
        webSocketTask = nil
    }

    private func handleWebSocketFrame(_ data: Data) {
        guard let envelope = try? JSONDecoder.emberDecoder.decode(WSEnvelope.self, from: data) else { return }
        switch envelope.type {
        case "message", "breakout:message":
            if let chatID = envelope.chatId, let message = envelope.message {
                breakoutContinuations[chatID]?.yield(message)
            }
        case "breakout:snapshot":
            if let chatID = envelope.chatId, let messages = envelope.messages {
                for message in messages { breakoutContinuations[chatID]?.yield(message) }
            }
        default:
            break // expiryWarning/purged/promoted are consumed via VolatileChatStore locally on-device already.
        }
    }
}

// MARK: - Wire types

private struct AuthResponse: Decodable {
    let token: String
    let user: WireUser
}

private struct WireUser: Decodable {
    let id: String
}

private struct BreakoutStartedResponse: Decodable {
    let id: String
}

private struct PromoteResponse: Decodable {
    let id: String
    let isPersisted: Bool
    let messageCount: Int
}

private struct WSEnvelope: Decodable {
    let type: String
    let chatId: String?
    let message: Message?
    let messages: [Message]?
}

public enum EmberBackendError: Error, LocalizedError {
    case server(String)
    public var errorDescription: String? {
        switch self {
        case .server(let message): return message
        }
    }
}

extension JSONDecoder {
    static let emberDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

extension JSONEncoder {
    static let emberEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}
