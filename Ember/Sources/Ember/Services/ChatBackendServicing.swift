import Foundation

/// Abstraction over the remote backend so Firebase can be swapped for a
/// custom REST/WebSocket implementation without touching view models.
public protocol ChatBackendServicing: Sendable {
    // Auth
    func currentUserID() async -> String?

    // Persisted chats
    func fetchChats(for userID: String) async throws -> [Chat]
    func fetchMessages(chatID: String, before: Date?, limit: Int) async throws -> [Message]
    func sendMessage(_ message: Message) async throws
    func createChat(_ chat: Chat) async throws -> Chat
    func updateChat(_ chat: Chat) async throws

    // Presence
    func setTyping(chatID: String, userID: String, isTyping: Bool) async throws
    func setPresence(userID: String, isOnline: Bool) async throws

    // Volatile / breakout realtime channel — intentionally separate from
    // the Firestore-backed methods above so volatile traffic never touches
    // persistent storage paths.
    func streamBreakoutMessages(chatID: String) -> AsyncStream<Message>
    func publishBreakoutMessage(_ message: Message, chatID: String) async throws
    /// Starts a breakout chat server-side and returns its id. Named
    /// "notify" because for a Firebase-style backend this might just be
    /// announcing a client-generated id rather than minting one — but
    /// for EmberBackendService, the returned id is authoritative and
    /// must be used as the breakout chat's id on this device.
    func notifyBreakoutStarted(parentChatID: String, participantIDs: [String]) async throws -> String

    /// "Keep this chat" — tells the backend to promote the breakout to a
    /// persisted chat. The local `VolatileChatStore.promote` handler
    /// should call this rather than writing to SwiftData directly, since
    /// the server is the source of truth for persisted chats.
    func promoteBreakout(chatID: String) async throws

    /// "End Breakout" — tells the backend to start the clearance warning
    /// window for all participants.
    func endBreakout(chatID: String) async throws
}
