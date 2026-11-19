import SwiftUI

/// Thin coordinator: decides whether to show onboarding or the main
/// conversation list, and owns the shared services so view models can be
/// constructed with them.
public struct AppCoordinatorView: View {
    let backend: ChatBackendServicing
    let volatileStore: VolatileChatStore
    let tombstoneLogger: BreakoutTombstoneLogger

    @State private var currentUserID: String?
    @State private var hasSeenVolatileExplainer = UserDefaults.standard.bool(forKey: "hasSeenVolatileExplainer")

    public init(backend: ChatBackendServicing, volatileStore: VolatileChatStore, tombstoneLogger: BreakoutTombstoneLogger) {
        self.backend = backend
        self.volatileStore = volatileStore
        self.tombstoneLogger = tombstoneLogger
    }

    public var body: some View {
        Group {
            if let userID = currentUserID {
                NavigationStack {
                    ConversationListView(
                        viewModel: ConversationListViewModel(backend: backend, currentUserID: userID),
                        backend: backend,
                        volatileStore: volatileStore,
                        tombstoneLogger: tombstoneLogger,
                        currentUserID: userID
                    )
                }
                .sheet(isPresented: .constant(!hasSeenVolatileExplainer)) {
                    VolatileExplainerSheet {
                        hasSeenVolatileExplainer = true
                        UserDefaults.standard.set(true, forKey: "hasSeenVolatileExplainer")
                    }
                }
            } else {
                OnboardingView(backend: backend) { userID in
                    currentUserID = userID
                }
            }
        }
        .task {
            currentUserID = await backend.currentUserID()
        }
    }
}
