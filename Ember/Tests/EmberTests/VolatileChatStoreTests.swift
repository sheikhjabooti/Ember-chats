import XCTest
@testable import Ember

final class VolatileChatStoreTests: XCTestCase {

    private func makeChat(inactivityTimeout: TimeInterval = 30 * 60) -> Chat {
        Chat(
            kind: .breakout,
            parentChatID: "parent-1",
            participantIDs: ["u1", "u2"],
            isPersisted: false,
            expiresAt: Date().addingTimeInterval(inactivityTimeout),
            inactivityTimeout: inactivityTimeout,
            createdAt: .now,
            createdByUserID: "u1"
        )
    }

    // MARK: - Creation

    func test_register_startsChatWithEmptyMessages() async {
        let store = VolatileChatStore()
        let chat = makeChat()
        await store.register(chat)

        let count = await store.activeChatCount
        let messages = await store.messages(in: chat.id)

        XCTAssertEqual(count, 1)
        XCTAssertTrue(messages.isEmpty)
    }

    func test_append_addsMessageAndEmitsEvent() async {
        let store = VolatileChatStore(warningWindow: 1)
        let chat = makeChat()
        await store.register(chat)

        let eventTask = Task {
            var received: VolatileChatEvent?
            for await event in await store.events(for: chat.id) {
                received = event
                break
            }
            return received
        }

        // Give the subscriber a moment to attach before appending.
        try? await Task.sleep(nanoseconds: 50_000_000)

        let message = Message(chatID: chat.id, senderID: "u1", text: "hey")
        await store.append(message, to: chat.id)

        let event = await eventTask.value
        let stored = await store.messages(in: chat.id)

        XCTAssertEqual(stored.count, 1)
        XCTAssertEqual(stored.first?.text, "hey")
        if case .messageAppended(let chatID, let msg) = event {
            XCTAssertEqual(chatID, chat.id)
            XCTAssertEqual(msg.text, "hey")
        } else {
            XCTFail("Expected messageAppended event, got \(String(describing: event))")
        }
    }

    // MARK: - Expiry countdown

    func test_requestEnd_startsWarningCountdownAndAutoPurges() async {
        let store = VolatileChatStore(warningWindow: 1) // short window for the test
        let chat = makeChat()
        await store.register(chat)

        var sawWarning = false
        var sawPurge = false

        let collector = Task {
            for await event in await store.events(for: chat.id) {
                switch event {
                case .expiryWarning: sawWarning = true
                case .purged: sawPurge = true
                default: break
                }
                if sawPurge { break }
            }
        }

        try? await Task.sleep(nanoseconds: 50_000_000)
        await store.requestEnd(chat.id)

        // Wait past the 1-second warning window.
        _ = await collector.value

        XCTAssertTrue(sawWarning, "Expected an expiryWarning event before purge")
        XCTAssertTrue(sawPurge, "Expected chat to auto-purge after the warning window elapses")

        let count = await store.activeChatCount
        XCTAssertEqual(count, 0)
    }

    // MARK: - Keep Chat promotion

    func test_promote_handsOffFullHistoryThenPurgesMemory() async {
        let store = VolatileChatStore()
        let chat = makeChat()
        await store.register(chat)

        let m1 = Message(chatID: chat.id, senderID: "u1", text: "first")
        let m2 = Message(chatID: chat.id, senderID: "u2", text: "second")
        await store.append(m1, to: chat.id)
        await store.append(m2, to: chat.id)

        actor Sink {
            var savedMessages: [Message] = []
            var savedChat: Chat?
            func save(_ messages: [Message], _ chat: Chat) {
                savedMessages = messages
                savedChat = chat
            }
        }
        let sink = Sink()

        let handedOff = try? await store.promote(chat.id) { messages, promotedChat in
            await sink.save(messages, promotedChat)
        }

        let sunkMessages = await sink.savedMessages
        let sunkChat = await sink.savedChat

        // 1. The full history reached the persistence handler.
        XCTAssertEqual(handedOff?.count, 2)
        XCTAssertEqual(sunkMessages.map(\.text), ["first", "second"])
        XCTAssertEqual(sunkChat?.isPersisted, true)
        XCTAssertNil(sunkChat?.expiresAt)

        // 2. And the in-memory store is now empty (purged after handoff).
        let remainingMessages = await store.messages(in: chat.id)
        let remainingChat = await store.chat(chat.id)
        let count = await store.activeChatCount

        XCTAssertTrue(remainingMessages.isEmpty)
        XCTAssertNil(remainingChat)
        XCTAssertEqual(count, 0)
    }

    func test_promote_duringActiveConversation_notJustAtExpiry() async {
        // "Mid-conversation save" per spec 4.2: promote works even though
        // no expiry/warning was ever triggered.
        let store = VolatileChatStore()
        let chat = makeChat()
        await store.register(chat)
        await store.append(Message(chatID: chat.id, senderID: "u1", text: "quick save test"), to: chat.id)

        let history = try? await store.promote(chat.id) { _, _ in }

        XCTAssertEqual(history?.count, 1)
        let count = await store.activeChatCount
        XCTAssertEqual(count, 0)
    }

    // MARK: - Discard / purge leaves no trace

    func test_discard_leavesStoreCompletelyEmpty() async {
        let store = VolatileChatStore()
        let chat = makeChat()
        await store.register(chat)
        await store.append(Message(chatID: chat.id, senderID: "u1", text: "sensitive content"), to: chat.id)
        await store.append(Message(chatID: chat.id, senderID: "u2", text: "more sensitive content"), to: chat.id)

        await store.purge(chat.id)

        let messages = await store.messages(in: chat.id)
        let storedChat = await store.chat(chat.id)
        let count = await store.activeChatCount

        // No trace of message content remains in memory (and this store
        // never writes to disk in the first place, so this also proves
        // no trace on disk).
        XCTAssertTrue(messages.isEmpty)
        XCTAssertNil(storedChat)
        XCTAssertEqual(count, 0)
    }

    func test_purge_finishesEventStreamsForSubscribers() async {
        let store = VolatileChatStore()
        let chat = makeChat()
        await store.register(chat)

        let streamFinished = expectation(description: "stream finished")
        let collector = Task {
            for await _ in await store.events(for: chat.id) {}
            streamFinished.fulfill()
        }

        try? await Task.sleep(nanoseconds: 50_000_000)
        await store.purge(chat.id)

        await fulfillment(of: [streamFinished], timeout: 2.0)
        collector.cancel()
    }
}
