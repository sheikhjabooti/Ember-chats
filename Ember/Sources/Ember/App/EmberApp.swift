import SwiftUI
import SwiftData

@main
struct EmberApp: App {
    let modelContainer = PersistenceController.makeContainer()
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
