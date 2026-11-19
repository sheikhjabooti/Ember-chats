import Foundation
import Observation

@Observable
@MainActor
public final class ConversationListViewModel {
    public private(set) var chats: [Chat] = []
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?

    private let backend: ChatBackendServicing
    private let currentUserID: String

    public init(backend: ChatBackendServicing, currentUserID: String) {
        self.backend = backend
        self.currentUserID = currentUserID
    }

    public func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let fetched = try await backend.fetchChats(for: currentUserID)
            // Breakout chats surface as collapsible threads under their
            // parent, not mixed into the main timeline (spec 4.3).
            chats = fetched
                .filter { $0.kind != .breakout || $0.parentChatID == nil }
                .sorted { ($0.lastMessageAt ?? $0.createdAt) > ($1.lastMessageAt ?? $1.createdAt) }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    public func breakoutThreads(for parentChatID: String, in allChats: [Chat]) -> [Chat] {
        allChats.filter { $0.parentChatID == parentChatID }
    }
}
