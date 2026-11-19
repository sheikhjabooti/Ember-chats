import Foundation

public struct Chat: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public var kind: ChatKind
    public var title: String?               // nil for direct chats (derived from participant)
    public var parentChatID: String?         // set only for breakout chats
    public var participantIDs: [String]
    public var adminIDs: [String]            // relevant for .group
    public var isPersisted: Bool             // false until a breakout chat is "kept"
    public var expiresAt: Date?              // nil for persisted chats
    public var inactivityTimeout: TimeInterval // used to recompute expiresAt on activity
    public var createdAt: Date
    public var createdByUserID: String
    public var lastMessagePreview: String?
    public var lastMessageAt: Date?

    public init(
        id: String = UUID().uuidString,
        kind: ChatKind,
        title: String? = nil,
        parentChatID: String? = nil,
        participantIDs: [String],
        adminIDs: [String] = [],
        isPersisted: Bool = true,
        expiresAt: Date? = nil,
        inactivityTimeout: TimeInterval = 30 * 60,
        createdAt: Date = .now,
        createdByUserID: String,
        lastMessagePreview: String? = nil,
        lastMessageAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.parentChatID = parentChatID
        self.participantIDs = participantIDs
        self.adminIDs = adminIDs
        self.isPersisted = isPersisted
        self.expiresAt = expiresAt
        self.inactivityTimeout = inactivityTimeout
        self.createdAt = createdAt
        self.createdByUserID = createdByUserID
        self.lastMessagePreview = lastMessagePreview
        self.lastMessageAt = lastMessageAt
    }

    public var isVolatile: Bool { kind == .breakout && !isPersisted }
}

extension Chat {
    private enum CodingKeys: String, CodingKey {
        case id, kind, title
        case parentChatID = "parentChatId"
        case participantIDs = "participantIds"
        case adminIDs
        case isPersisted
        case expiresAt
        case inactivityTimeout = "inactivityTimeoutSeconds"
        case createdAt
        case createdByUserID = "createdByUserId"
        case lastMessagePreview, lastMessageAt
    }

    /// Custom keys because the server (see EmberServer's
    /// `toChatJson`/breakout payloads) uses `...Id`/`...Ids` while Swift
    /// naming conventions call for `...ID`/`...IDs` — and custom
    /// decoding so `adminIDs`/`expiresAt`, which the server doesn't
    /// currently send, default sensibly instead of failing to decode.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(ChatKind.self, forKey: .kind)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        parentChatID = try container.decodeIfPresent(String.self, forKey: .parentChatID)
        participantIDs = try container.decodeIfPresent([String].self, forKey: .participantIDs) ?? []
        adminIDs = try container.decodeIfPresent([String].self, forKey: .adminIDs) ?? []
        isPersisted = try container.decodeIfPresent(Bool.self, forKey: .isPersisted) ?? true
        expiresAt = try container.decodeIfPresent(Date.self, forKey: .expiresAt)
        inactivityTimeout = try container.decodeIfPresent(TimeInterval.self, forKey: .inactivityTimeout) ?? 30 * 60
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        createdByUserID = try container.decode(String.self, forKey: .createdByUserID)
        lastMessagePreview = try container.decodeIfPresent(String.self, forKey: .lastMessagePreview)
        lastMessageAt = try container.decodeIfPresent(Date.self, forKey: .lastMessageAt)
    }
}
