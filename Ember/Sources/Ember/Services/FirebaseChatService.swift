import Foundation
// import FirebaseAuth
// import FirebaseFirestore
// import FirebaseDatabase
//
// These imports are commented out because Firebase's SPM packages are
// resolved through Xcode (see Package.swift comment). Uncomment once
// the Firebase package is added to the Ember target in Xcode.

/// Firestore/Realtime-Database backed implementation of
/// `ChatBackendServicing`. Persisted chats/messages go through Firestore;
/// breakout traffic goes through Realtime Database so it never lands in
/// the same durable store as normal chats by default (spec 4.2).
public final class FirebaseChatService: ChatBackendServicing {

    public init() {}

    public func currentUserID() async -> String? {
        // Auth.auth().currentUser?.uid
        fatalError("Wire up FirebaseAuth.Auth.auth().currentUser?.uid here.")
    }

    public func fetchChats(for userID: String) async throws -> [Chat] {
        // Firestore.firestore().collection("chats")
        //     .whereField("participantIDs", arrayContains: userID)
        //     .order(by: "lastMessageAt", descending: true)
        //     .getDocuments() ... map to [Chat]
        fatalError("Wire up Firestore query here.")
    }

    public func fetchMessages(chatID: String, before: Date?, limit: Int) async throws -> [Message] {
        // Firestore.firestore().collection("chats/\(chatID)/messages")
        //     .order(by: "sentAt", descending: true)
        //     .limit(to: limit) ... apply `before` cursor if present
        fatalError("Wire up paginated Firestore message query here.")
    }

    public func sendMessage(_ message: Message) async throws {
        // Firestore.firestore().collection("chats/\(message.chatID)/messages")
        //     .document(message.id).setData(from: message)
        fatalError("Wire up Firestore write here.")
    }

    public func createChat(_ chat: Chat) async throws -> Chat {
        // Firestore.firestore().collection("chats").document(chat.id).setData(from: chat)
        fatalError("Wire up Firestore chat creation here.")
    }

    public func updateChat(_ chat: Chat) async throws {
        fatalError("Wire up Firestore chat update here.")
    }

    public func setTyping(chatID: String, userID: String, isTyping: Bool) async throws {
        // Realtime Database presence node: /presence/\(chatID)/typing/\(userID)
        fatalError("Wire up Realtime Database presence write here.")
    }

    public func setPresence(userID: String, isOnline: Bool) async throws {
        fatalError("Wire up Realtime Database presence write here.")
    }

    public func streamBreakoutMessages(chatID: String) -> AsyncStream<Message> {
        // Realtime Database observe on /breakouts/\(chatID)/messages,
        // bridged into an AsyncStream. Never mirrored to Firestore.
        AsyncStream { continuation in
            // let ref = Database.database().reference(withPath: "breakouts/\(chatID)/messages")
            // let handle = ref.observe(.childAdded) { snapshot in ... continuation.yield(message) }
            continuation.onTermination = { _ in
                // ref.removeObserver(withHandle: handle)
            }
        }
    }

    public func publishBreakoutMessage(_ message: Message, chatID: String) async throws {
        // Database.database().reference(withPath: "breakouts/\(chatID)/messages")
        //     .childByAutoId().setValue(...)
        fatalError("Wire up Realtime Database breakout publish here.")
    }

    public func notifyBreakoutStarted(parentChatID: String, participantIDs: [String]) async throws -> String {
        // Write the parent-chat system message + trigger FCM push via a
        // Cloud Function (recommended) rather than sending pushes
        // client-side. Should return a newly-generated Firestore
        // document id for the breakout chat.
        fatalError("Wire up parent-chat system message + push trigger here.")
    }

    public func promoteBreakout(chatID: String) async throws {
        fatalError("Wire up: write breakout messages to Firestore, delete the Realtime Database copy.")
    }

    public func endBreakout(chatID: String) async throws {
        fatalError("Wire up: write an 'ending' flag to Realtime Database that all clients observe.")
    }
}
