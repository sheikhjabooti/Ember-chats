import Foundation
import Observation

@Observable
@MainActor
public final class BreakoutChatViewModel {
    public private(set) var chat: Chat
    public private(set) var messages: [Message] = []
    public private(set) var isShowingClearWarning = false
    public private(set) var secondsUntilClear = 0
    public private(set) var wasPurged = false
    public private(set) var wasPromoted = false

    private let store: VolatileChatStore
    private let backend: ChatBackendServicing
    private let tombstoneLogger: BreakoutTombstoneLogger
    private let currentUserID: String
    private var eventTask: Task<Void, Never>?
    private var backendStreamTask: Task<Void, Never>?

    public init(
        chat: Chat,
        store: VolatileChatStore,
        backend: ChatBackendServicing,
        tombstoneLogger: BreakoutTombstoneLogger,
        currentUserID: String
    ) {
        self.chat = chat
        self.store = store
        self.backend = backend
        self.tombstoneLogger = tombstoneLogger
        self.currentUserID = currentUserID
    }

    public func start() async {
        await store.register(chat)
        messages = await store.messages(in: chat.id)
        subscribeToLocalStoreEvents()
        subscribeToBackendStream()
    }

    /// Mirrors messages arriving from other participants (via the
    /// backend's WebSocket) into the local `VolatileChatStore`, which is
    /// what drives `messages` and the inactivity timer. The sender's own
    /// message also arrives this way (the server echoes it back), so
    /// `send(text:)` does not append locally itself — this is the single
    /// source of truth for what's on screen.
    private func subscribeToBackendStream() {
        backendStreamTask?.cancel()
        let chatID = chat.id
        let localStore = store
        backendStreamTask = Task {
            for await message in backend.streamBreakoutMessages(chatID: chatID) {
                await localStore.append(message, to: chatID)
            }
        }
    }

    private func subscribeToLocalStoreEvents() {
        eventTask?.cancel()
        let chatID = chat.id
        eventTask = Task { [weak self] in
            guard let self else { return }
            for await event in await self.store.events(for: chatID) {
                await self.handle(event)
            }
        }
    }

    private func handle(_ event: VolatileChatEvent) {
        switch event {
        case .messageAppended(_, let message):
            messages.append(message)
            isShowingClearWarning = false
        case .expiryWarning(_, let secondsRemaining):
            isShowingClearWarning = true
            secondsUntilClear = secondsRemaining
        case .purged:
            wasPurged = true
            isShowingClearWarning = false
            tombstoneLogger.record(chat: chat, endedAt: .now, wasKept: false)
        case .promoted:
            wasPromoted = true
            isShowingClearWarning = false
            var kept = chat
            kept.isPersisted = true
            kept.expiresAt = nil
            chat = kept
        }
    }

    public func send(text: String) async throws {
        let message = Message(chatID: chat.id, senderID: currentUserID, text: text)
        // Don't append locally here — the backend echoes every breakout
        // message (including the sender's own) back over the WebSocket,
        // and `subscribeToBackendStream()` is what appends into the
        // local store. Appending here too would show the message twice.
        try await backend.publishBreakoutMessage(message, chatID: chat.id)
    }

    /// "Keep this chat" — callable at any time, not just during the
    /// clearance warning (spec 4.2 "Mid-conversation save"). Tells the
    /// backend to persist the chat, then locally promotes (which purges
    /// this device's in-memory copy once the server confirms).
    public func keepChat() async throws {
        try await backend.promoteBreakout(chatID: chat.id)
        try await store.promote(chat.id) { _, _ in
            // The backend already wrote the persisted chat + messages
            // (see EmberServer's POST /breakouts/:id/keep). This handler
            // just needs to exist so the local store purges its copy.
        }
    }

    /// "End Breakout" — permitted participants can force the warning
    /// window rather than waiting for inactivity.
    public func endBreakout() async {
        try? await backend.endBreakout(chatID: chat.id)
        await store.requestEnd(chat.id)
    }

    public func participantLeft() async {
        // In a real transport layer this is driven by presence counts;
        // here it's exposed so the view can call it on `.onDisappear`
        // once it determines it was the last active viewer.
        await store.allParticipantsLeft(chat.id)
    }

    deinit {
        eventTask?.cancel()
        backendStreamTask?.cancel()
    }
}
