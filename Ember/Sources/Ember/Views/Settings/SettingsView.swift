import SwiftUI

public struct SettingsView: View {
    @AppStorage("tombstoneLoggingEnabled") private var tombstoneLoggingEnabled = Config.tombstoneLoggingDefaultEnabled
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true

    public init() {}

    public var body: some View {
        Form {
            Section("Notifications") {
                Toggle("New messages", isOn: $notificationsEnabled)
            }

            Section {
                Toggle("Log breakout chat history", isOn: $tombstoneLoggingEnabled)
            } header: {
                Text("Data & Storage")
            } footer: {
                Text("When on, Ember keeps a record that a breakout chat happened (participants and time) after it's cleared — never the message content. Breakout messages themselves are only ever stored in memory on participants' devices and are discarded when the chat clears, unless someone chooses \"Keep Chat.\"")
            }

            Section("Account") {
                NavigationLink("Blocked users") { EmptyView() }
                Button("Delete account", role: .destructive) {}
            }
        }
        .navigationTitle("Settings")
    }
}
