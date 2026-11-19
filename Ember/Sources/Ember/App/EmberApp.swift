import SwiftUI
import SwiftData

@main
struct EmberApp: App {
    let modelContainer = PersistenceController.makeContainer()
    // Swap for `FirebaseChatService()` if you'd rather run on Firebase —
    // both conform to `ChatBackendServicing`, so nothing else changes.
    let backend: ChatBackendServicing = EmberBackendService(baseURL: Config.serverBaseURL)
    let volatileStore = VolatileChatStore(warningWindow: Config.breakoutClearanceWarningWindow)

    @AppStorage("tombstoneLoggingEnabled") private var tombstoneLoggingEnabled = Config.tombstoneLoggingDefaultEnabled

    var body: some Scene {
        WindowGroup {
            AppCoordinatorView(
                backend: backend,
                volatileStore: volatileStore,
                tombstoneLogger: BreakoutTombstoneLogger(
                    modelContainer: modelContainer,
                    isEnabled: { UserDefaults.standard.bool(forKey: "tombstoneLoggingEnabled") }
                )
            )
        }
        .modelContainer(modelContainer)
    }
}
