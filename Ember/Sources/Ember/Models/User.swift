import Foundation

public struct User: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public var displayName: String
    public var avatarURL: URL?
    public var statusMessage: String?
    public var lastSeenAt: Date?
    public var isOnline: Bool

    public init(
        id: String,
        displayName: String,
        avatarURL: URL? = nil,
        statusMessage: String? = nil,
        lastSeenAt: Date? = nil,
        isOnline: Bool = false
    ) {
        self.id = id
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.statusMessage = statusMessage
        self.lastSeenAt = lastSeenAt
        self.isOnline = isOnline
    }
}
