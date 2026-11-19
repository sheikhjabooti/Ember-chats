import Foundation
import SwiftData

@Model
public final class PersistedChat {
    @Attribute(.unique) public var id: String
    public var kindRaw: String
    public var title: String?
    public var parentChatID: String?
    public var participantIDs: [String]
    public var adminIDs: [String]
    public var createdAt: Date
    public var createdByUserID: String
    public var lastMessagePreview: String?
    public var lastMessageAt: Date?

    public init(from chat: Chat) {
        self.id = chat.id
        self.kindRaw = chat.kind.rawValue
        self.title = chat.title
        self.parentChatID = chat.parentChatID
        self.participantIDs = chat.participantIDs
        self.adminIDs = chat.adminIDs
        self.createdAt = chat.createdAt
        self.createdByUserID = chat.createdByUserID
        self.lastMessagePreview = chat.lastMessagePreview
        self.lastMessageAt = chat.lastMessageAt
    }

    public func asChat() -> Chat {
        Chat(
            id: id,
            kind: ChatKind(rawValue: kindRaw) ?? .direct,
            title: title,
            parentChatID: parentChatID,
            participantIDs: participantIDs,
            adminIDs: adminIDs,
            isPersisted: true,
            expiresAt: nil,
            createdAt: createdAt,
            createdByUserID: createdByUserID,
            lastMessagePreview: lastMessagePreview,
            lastMessageAt: lastMessageAt
        )
    }
}

@Model
public final class PersistedMessage {
    @Attribute(.unique) public var id: String
    public var chatID: String
    public var senderID: String
    public var text: String?
    public var sentAt: Date
    public var editedAt: Date?
    public var deletionStateRaw: String
    public var replyToMessageID: String?

    public init(from message: Message) {
        self.id = message.id
        self.chatID = message.chatID
        self.senderID = message.senderID
        self.text = message.text
        self.sentAt = message.sentAt
        self.editedAt = message.editedAt
        self.deletionStateRaw = message.deletionState.rawValue
        self.replyToMessageID = message.replyToMessageID
    }
}

public enum PersistenceController {
    public static func makeContainer(inMemoryOnly: Bool = false) -> ModelContainer {
        let schema = Schema([PersistedChat.self, PersistedMessage.self, BreakoutTombstone.self])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemoryOnly)
        return try! ModelContainer(for: schema, configurations: [configuration])
    }
}
