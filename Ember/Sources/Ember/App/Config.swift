import Foundation

/// Fill these in with your own Firebase project values before running.
/// Nothing here is a real credential — do not commit real secrets to
/// source control; prefer `GoogleService-Info.plist` (added via Xcode,
/// gitignored) for the Firebase SDK's own config, and use this struct
/// only for values the app code reads directly (e.g. feature flags,
/// default timeouts).
public enum Config {
    /// Base URL of the Ember Server backend (see the sibling
    /// `EmberServer` project). Point this at your deployed instance;
    /// defaults to localhost for development against `npm run dev`.
    public static let serverBaseURL = URL(string: "http://localhost:4000")!

    /// Default inactivity timeout for new breakout chats, in seconds.
    /// Spec default: 30 minutes.
    public static let breakoutInactivityTimeout: TimeInterval = 30 * 60

    /// Countdown shown in the "about to be cleared" sheet, in seconds.
    public static let breakoutClearanceWarningWindow: TimeInterval = 15

    /// APNs / FCM sender ID — replace with your Firebase project's value.
    /// Do NOT hardcode a real key here; this is a placeholder.
    public static let fcmSenderID = "REPLACE_ME_FCM_SENDER_ID"

    /// Whether breakout tombstone logging is enabled by default before
    /// the user visits Settings. Spec 4.2: "make this a toggleable
    /// setting" — default is off (opt-in), favoring privacy.
    public static let tombstoneLoggingDefaultEnabled = false
}
