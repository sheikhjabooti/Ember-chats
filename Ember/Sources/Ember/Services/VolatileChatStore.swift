import Foundation

/// Events the store emits so UI layers can react (e.g. show the
/// "about to be cleared" confirmation sheet, or reflect a promotion).
public enum VolatileChatEvent: Sendable, Equatable {
    case messageAppended(chatID: String, message: Message)
    case expiryWarning(chatID: String, secondsRemaining: Int)
    case purged(chatID: String)
    case promoted(chatID: String)
}

/// Non-persistent, actor-isolated store for breakout chat messages.
///
/// Nothing here is ever written to SwiftData, Firestore, UserDefaults,
/// or any file on disk. `messagesByChat` is the *only* place breakout
/// message content lives while a chat is volatile. Once `purge(_:)` runs,
/// the dictionary entry is removed and no other reference to that
/// content is retained anywhere in this type.
public actor VolatileChatStore {

    public typealias PromotionHandler = @Sendable ([Message], Chat) async throws -> Void

    private var messagesByChat: [String: [Message]] = [:]
    private var chatsByID: [String: Chat] = [:]
    private var expiryTasks: [String: Task<Void, Never>] = [:]
    private var warningGraceTasks: [String: Task<Void, Never>] = [:]

    /// Consumers subscribe to this to receive lifecycle events. Each call
    /// to `events(for:)` yields a fresh stream; the store fans out to all
    /// active continuations.
    private var eventContinuations: [String: [UUID: AsyncStream<VolatileChatEvent>.Continuation]] = [:]

    /// How long the "about to be cleared, Keep Chat?" warning window lasts
    /// before an automatic purge, per section 4.2 of the spec.
    public let warningWindow: TimeInterval

    public init(warningWindow: TimeInterval = 15) {
        self.warningWindow = warningWindow
    }

    // MARK: - Chat registration

    /// Registers a newly created breakout chat and starts its inactivity
    /// timer. `chat.expiresAt` should already be populated by the caller
    /// based on `chat.inactivityTimeout`.
    public func register(_ chat: Chat) {
        precondition(chat.kind == .breakout, "VolatileChatStore only manages breakout chats")
        chatsByID[chat.id] = chat
        messagesByChat[chat.id] = messagesByChat[chat.id] ?? []
        scheduleExpiry(for: chat.id)
    }

    public func chat(_ chatID: String) -> Chat? {
        chatsByID[chatID]
    }

    public func messages(in chatID: String) -> [Message] {
        messagesByChat[chatID] ?? []
    }

    // MARK: - Event stream

    public func events(for chatID: String) -> AsyncStream<VolatileChatEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            eventContinuations[chatID, default: [:]][id] = continuation
            continuation.onTermination = { [weak self] _ in
                guard let self else { return }
                Task { await self.removeContinuation(id, for: chatID) }
            }
        }
    }

    private func removeContinuation(_ id: UUID, for chatID: String) {
        eventContinuations[chatID]?.removeValue(forKey: id)
    }

    private func emit(_ event: VolatileChatEvent, to chatID: String) {
        eventContinuations[chatID]?.values.forEach { $0.yield(event) }
    }

    // MARK: - Message lifecycle

    /// Appends a message and resets the inactivity timer, per spec 4.2
    /// ("Inactivity timeout... of no new messages").
    public func append(_ message: Message, to chatID: String) {
        guard chatsByID[chatID] != nil else { return }
        messagesByChat[chatID, default: []].append(message)
        emit(.messageAppended(chatID: chatID, message: message), to: chatID)
        resetExpiry(for: chatID)
    }

    /// Explicit "End Breakout" action by a permitted participant. Skips
    /// straight to the warning window rather than an immediate purge, so
    /// remaining participants still get the "Keep Chat?" opportunity.
    public func requestEnd(_ chatID: String) {
        beginWarningWindow(for: chatID)
    }

    /// Called when the store determines all participants have left
    /// (transport layer reports zero active viewers). Also routes through
    /// the warning window so a lone remaining/reconnecting participant can
    /// still rescue it.
    public func allParticipantsLeft(_ chatID: String) {
        beginWarningWindow(for: chatID)
    }

    /// Promotes a breakout chat to persisted storage. Hands the full
    /// message history to `handler` (expected to write to SwiftData /
    /// Firestore), then purges the in-memory copy. Safe to call at any
    /// point in the conversation, not just during the expiry window,
    /// per spec 4.2 "Mid-conversation save".
    @discardableResult
    public func promote(_ chatID: String, using handler: PromotionHandler) async rethrows -> [Message] {
        let history = messagesByChat[chatID] ?? []
        guard var chat = chatsByID[chatID] else { return history }
        chat.isPersisted = true
        chat.expiresAt = nil
        try await handler(history, chat)
        emit(.promoted(chatID: chatID), to: chatID)
        purge(chatID)
        return history
    }

    /// Hard delete: removes all message content and chat metadata for
    /// `chatID` from memory. After this returns, `messages(in: chatID)`
    /// is empty and `chat(chatID)` is nil — no trace remains.
    public func purge(_ chatID: String) {
        messagesByChat.removeValue(forKey: chatID)
        chatsByID.removeValue(forKey: chatID)
        expiryTasks[chatID]?.cancel()
        expiryTasks.removeValue(forKey: chatID)
        warningGraceTasks[chatID]?.cancel()
        warningGraceTasks.removeValue(forKey: chatID)
        emit(.purged(chatID: chatID), to: chatID)
        eventContinuations[chatID]?.values.forEach { $0.finish() }
        eventContinuations.removeValue(forKey: chatID)
    }

    // MARK: - Timers

    private func scheduleExpiry(for chatID: String) {
        expiryTasks[chatID]?.cancel()
        guard let chat = chatsByID[chatID], let expiresAt = chat.expiresAt else { return }
        let delay = expiresAt.timeIntervalSinceNow
        guard delay > 0 else {
            beginWarningWindow(for: chatID)
            return
        }
        expiryTasks[chatID] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(delay, 0) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.beginWarningWindow(for: chatID)
        }
    }

    private func resetExpiry(for chatID: String) {
        guard var chat = chatsByID[chatID] else { return }
        chat.expiresAt = Date().addingTimeInterval(chat.inactivityTimeout)
        chatsByID[chatID] = chat
        scheduleExpiry(for: chatID)
    }

    /// Starts the "about to be cleared" warning countdown. If nothing
    /// rescues the chat (via `promote`) before `warningWindow` elapses,
    /// the chat is purged automatically — spec 4.2 "Let it go / no response".
    private func beginWarningWindow(for chatID: String) {
        guard chatsByID[chatID] != nil, warningGraceTasks[chatID] == nil else { return }
        expiryTasks[chatID]?.cancel()

        let totalSeconds = Int(warningWindow)
        emit(.expiryWarning(chatID: chatID, secondsRemaining: totalSeconds), to: chatID)

        warningGraceTasks[chatID] = Task { [weak self] in
            guard let self else { return }
            var remaining = totalSeconds
            while remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                remaining -= 1
                await self.emitWarningTick(chatID: chatID, secondsRemaining: remaining)
            }
            guard !Task.isCancelled else { return }
            await self.purge(chatID)
        }
    }

    private func emitWarningTick(chatID: String, secondsRemaining: Int) {
        guard chatsByID[chatID] != nil else { return }
        emit(.expiryWarning(chatID: chatID, secondsRemaining: secondsRemaining), to: chatID)
    }

    // MARK: - Diagnostics (testing / debug only)

    /// Number of chats currently tracked. Exposed for tests to assert the
    /// store is fully empty after a purge.
    public var activeChatCount: Int { chatsByID.count }
}
