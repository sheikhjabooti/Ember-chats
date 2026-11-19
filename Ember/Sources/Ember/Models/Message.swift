import Foundation

public enum MessageAttachmentKind: String, Codable, Sendable {
    case image
    case video
    case voiceNote
}

public struct MessageAttachment: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public var kind: MessageAttachmentKind
    public var url: URL
    public var durationSeconds: Double?
    public var thumbnailURL: URL?

    public init(id: String = UUID().uuidString, kind: MessageAttachmentKind, url: URL, durationSeconds: Double? = nil, thumbnailURL: URL? = nil) {
        self.id = id
        self.kind = kind
        self.url = url
        self.durationSeconds = durationSeconds
        self.thumbnailURL = thumbnailURL
    }
}

public enum MessageDeletionState: String, Codable, Sendable {
    case none
    case deletedForMe
    case deletedForEveryone
}

public struct Message: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public var chatID: String
    public var senderID: String
    public var text: String?
    public var attachments: [MessageAttachment]
    public var sentAt: Date
    public var editedAt: Date?
    public var deletionState: MessageDeletionState
    public var replyToMessageID: String?
    public var reactions: [String: [String]] // emoji -> [userID]
    public var readByUserIDs: Set<String>

    public init(
        id: String = UUID().uuidString,
        chatID: String,
        senderID: String,
        text: String? = nil,
        attachments: [MessageAttachment] = [],
        sentAt: Date = .now,
        editedAt: Date? = nil,
        deletionState: MessageDeletionState = .none,
        replyToMessageID: String? = nil,
        reactions: [String: [String]] = [:],
        readByUserIDs: Set<String> = []
    ) {
        self.id = id
        self.chatID = chatID
        self.senderID = senderID
        self.text = text
        self.attachments = attachments
        self.sentAt = sentAt
        self.editedAt = editedAt
        self.deletionState = deletionState
        self.replyToMessageID = replyToMessageID
        self.reactions = reactions
        self.readByUserIDs = readByUserIDs
    }
}

extension Message {
    private enum CodingKeys: String, CodingKey {
        case id, chatID = "chatId", senderID = "senderId", text, attachments, sentAt, editedAt
        case deletionState, replyToMessageID = "replyToMessageId", reactions, readByUserIDs
    }

    /// Custom decoding so partial wire payloads decode successfully —
    /// notably the server's real-time breakout message events, which
    /// only ever send `{id, chatId, senderId, text, sentAt}` and rely on
    /// every other field defaulting sensibly rather than round-tripping
    /// data the volatile store never persisted in the first place.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        chatID = try container.decode(String.self, forKey: .chatID)
        senderID = try container.decode(String.self, forKey: .senderID)
        text = try container.decodeIfPresent(String.self, forKey: .text)
        attachments = try container.decodeIfPresent([MessageAttachment].self, forKey: .attachments) ?? []
        sentAt = try container.decode(Date.self, forKey: .sentAt)
        editedAt = try container.decodeIfPresent(Date.self, forKey: .editedAt)
        deletionState = try container.decodeIfPresent(MessageDeletionState.self, forKey: .deletionState) ?? .none
        replyToMessageID = try container.decodeIfPresent(String.self, forKey: .replyToMessageID)
        reactions = try container.decodeIfPresent([String: [String]].self, forKey: .reactions) ?? [:]
        readByUserIDs = try container.decodeIfPresent(Set<String>.self, forKey: .readByUserIDs) ?? []
    }
}
