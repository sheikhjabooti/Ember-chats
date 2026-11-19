import Foundation
import SwiftData

/// A record that a breakout chat existed and was discarded, deliberately
/// excluding any message content. Persisted only when the user has
/// enabled "Log breakout chat history" in Settings (spec 4.2 / 6).
@Model
public final class BreakoutTombstone {
    @Attribute(.unique) public var id: String
    public var parentChatID: String
    public var participantIDs: [String]
    public var startedAt: Date
    public var endedAt: Date
    public var wasKept: Bool

    public init(id: String = UUID().uuidString, parentChatID: String, participantIDs: [String], startedAt: Date, endedAt: Date, wasKept: Bool) {
        self.id = id
        self.parentChatID = parentChatID
        self.participantIDs = participantIDs
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.wasKept = wasKept
    }
}

/// Writes tombstones only when enabled, and never touches message text.
public struct BreakoutTombstoneLogger: Sendable {
    private let modelContainer: ModelContainer
    private let isEnabled: @Sendable () -> Bool

    public init(modelContainer: ModelContainer, isEnabled: @escaping @Sendable () -> Bool) {
        self.modelContainer = modelContainer
        self.isEnabled = isEnabled
    }

    @MainActor
    public func record(chat: Chat, endedAt: Date, wasKept: Bool) {
        guard isEnabled() else { return }
        let context = modelContainer.mainContext
        let tombstone = BreakoutTombstone(
            parentChatID: chat.parentChatID ?? chat.id,
            participantIDs: chat.participantIDs,
            startedAt: chat.createdAt,
            endedAt: endedAt,
            wasKept: wasKept
        )
        context.insert(tombstone)
        try? context.save()
    }
}
