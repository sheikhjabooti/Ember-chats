import SwiftUI

public struct OnboardingView: View {
    let backend: ChatBackendServicing
    let onSignedIn: (String) -> Void
    @State private var identifier = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var isRegistering = true
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    public init(backend: ChatBackendServicing, onSignedIn: @escaping (String) -> Void) {
        self.backend = backend
        self.onSignedIn = onSignedIn
    }

    public var body: some View {
        NavigationStack {
            Form {
                Picker("", selection: $isRegistering) {
                    Text("Sign up").tag(true)
                    Text("Log in").tag(false)
                }
                .pickerStyle(.segmented)

                Section("Sign in") {
                    TextField("Email", text: $identifier)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(isRegistering ? .newPassword : .password)
                }
                if isRegistering {
                    Section("Profile") {
                        TextField("Display name", text: $displayName)
                            .textContentType(.name)
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).font(.footnote)
                }
                Button(isSubmitting ? "…" : (isRegistering ? "Create account" : "Log in")) {
                    Task { await submit() }
                }
                .disabled(isSubmitting || identifier.isEmpty || password.isEmpty || (isRegistering && displayName.isEmpty))
            }
            .navigationTitle("Welcome to Ember")
        }
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let userID: String
            if let ember = backend as? EmberBackendService {
                userID = isRegistering
                    ? try await ember.register(email: identifier, password: password, displayName: displayName)
                    : try await ember.signIn(email: identifier, password: password)
            } else {
                // FirebaseChatService or another ChatBackendServicing
                // implementation: wire its own auth flow here.
                userID = await backend.currentUserID() ?? UUID().uuidString
            }
            onSignedIn(userID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// One-time explainer required by spec section 6 ("Privacy") before a
/// user's first breakout chat.
public struct VolatileExplainerSheet: View {
    let onContinue: () -> Void

    public init(onContinue: @escaping () -> Void) {
        self.onContinue = onContinue
    }

    public var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "flame.fill")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text("About Breakout Chats")
                .font(.title2.bold())
            Text("Breakout chats are for quick side conversations. Messages live only on your devices while the chat is open, and are cleared automatically when everyone leaves — unless someone taps \"Keep Chat.\"")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Got it", action: onContinue)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
