import Foundation
import Observation

@Observable
@MainActor
public final class ChatViewModel {
    public private(set) var chat: Chat
    public private(set) var messages: [Message] = []
    public private(set) var isLoadingOlder = false
    public var typingUserIDs: Set<String> = []

    private let backend: ChatBackendServicing
    private let currentUserID: String
    private let pageSize = 30

    public init(chat: Chat, backend: ChatBackendServicing, currentUserID: String) {
        self.chat = chat
        self.backend = backend
        self.currentUserID = currentUserID
    }

    public func loadInitial() async {
        do {
            messages = try await backend.fetchMessages(chatID: chat.id, before: nil, limit: pageSize)
        } catch {
            // Surface via a published error banner in the view in a full build.
        }
    }

    public func loadOlder() async {
        guard !isLoadingOlder, let oldest = messages.first?.sentAt else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let older = try await backend.fetchMessages(chatID: chat.id, before: oldest, limit: pageSize)
            messages.insert(contentsOf: older, at: 0)
        } catch {
            // no-op: keep existing page on failure
        }
    }

    public func send(text: String, replyTo: String? = nil) async throws {
        let message = Message(chatID: chat.id, senderID: currentUserID, text: text, replyToMessageID: replyTo)
        try await backend.sendMessage(message)
        messages.append(message)
    }

    public func setTyping(_ isTyping: Bool) async {
        try? await backend.setTyping(chatID: chat.id, userID: currentUserID, isTyping: isTyping)
    }

    /// Asks the backend to start a breakout chat and returns a `Chat`
    /// built from the server-assigned id — using that id (rather than
    /// inventing one locally) is what lets other participants' devices
    /// join the same breakout chat.
    public func startBreakout(with participantIDs: [String]) async throws -> Chat {
        let inactivityTimeout: TimeInterval = Config.breakoutInactivityTimeout
        let breakoutID = try await backend.notifyBreakoutStarted(parentChatID: chat.id, participantIDs: participantIDs)
        return Chat(
            id: breakoutID,
            kind: .breakout,
            parentChatID: chat.id,
            participantIDs: [currentUserID] + participantIDs,
            isPersisted: false,
            expiresAt: Date().addingTimeInterval(inactivityTimeout),
            inactivityTimeout: inactivityTimeout,
            createdAt: .now,
            createdByUserID: currentUserID
        )
    }
}
