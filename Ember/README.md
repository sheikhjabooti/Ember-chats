# Ember

A native iOS chat app (SwiftUI, iOS 17+) with **Volatile Breakout Chats** —
ephemeral side conversations that self-destruct unless someone taps
"Keep Chat."

## What's implemented

- **Data models** (`Sources/Ember/Models`): `Chat`, `Message`, `User`, `ChatKind`.
- **`VolatileChatStore`** (`Sources/Ember/Services/VolatileChatStore.swift`):
  the actor-isolated, non-persistent core of the breakout-chat feature —
  registration, inactivity timers, the 15s "about to be cleared" warning
  window, `promote()` (Keep Chat), and `purge()` (hard delete). Fully
  covered by `Tests/EmberTests/VolatileChatStoreTests.swift`, including a
  test asserting the store is completely empty after a purge.
- **View models**: `ConversationListViewModel`, `ChatViewModel`,
  `BreakoutChatViewModel` — the latter wires the store's event stream to
  UI state (message list, clearance countdown, promoted/purged flags).
- **Views**: conversation list, standard chat view with a "Start
  Breakout" entry point and participant picker, the breakout chat view
  (amber/dashed bubbles, volatile pill with live countdown, persistent
  "Keep Chat" banner, clearance warning sheet), a one-time volatile-chat
  explainer sheet, onboarding, and settings (including the tombstone
  logging toggle).
- **Persistence**: SwiftData models for persisted chats/messages and for
  the optional, content-free breakout tombstone log.
- **Backend abstraction**: `ChatBackendServicing` protocol plus a
  `FirebaseChatService` skeleton with every method's intended Firebase
  call documented in comments (see "Wiring Firebase" below).

## What's stubbed and needs wiring

These are marked with `fatalError("Wire up ...")` or inline comments
rather than silently faked, per the spec's instruction not to hardcode
fake credentials or pretend behavior:

- `FirebaseChatService` — every method needs the actual Firebase SDK
  calls (Firestore for persisted chats, Realtime Database for the
  breakout channel, Auth for sign-in). The intended call is documented
  as a comment above each `fatalError`.
- Push notifications (APNs/FCM registration + Cloud Function triggers
  for breakout invites) — not implemented; `Config.fcmSenderID` is a
  placeholder.
- Media handling (PhotosUI attachment picker, AVFoundation voice notes)
  — model support exists (`MessageAttachment`) but the picker UI isn't
  built yet.
- Read receipts / reactions UI — modeled on `Message` but not yet
  rendered in `MessageBubble`.
- XCUITest flows for the core chat and breakout-expiry paths — the
  `Tests/EmberUITests` target exists but needs a running app target
  (see below) before XCUITest can drive it.

## Project structure

```
Ember/
  Package.swift
  Sources/Ember/
    App/            EmberApp.swift, AppCoordinator.swift, Config.swift
    Models/         Chat, Message, User, ChatKind
    Services/       ChatBackendServicing, FirebaseChatService,
                     VolatileChatStore, BreakoutTombstoneLog
    Persistence/     SwiftDataModels, PersistenceController
    ViewModels/      ConversationListViewModel, ChatViewModel,
                     BreakoutChatViewModel
    Views/           ConversationList/, Chat/, Breakout/, Settings/,
                     Onboarding/
  Tests/
    EmberTests/      VolatileChatStoreTests.swift
    EmberUITests/    (scaffold — add once wired into an app target)
```

## Setup

This repo is a Swift Package (`Package.swift`) so `Sources/Ember` can be
compiled and unit-tested with `swift test` on its own — but to ship an
actual iOS app you need an Xcode **App** target, because:

1. SwiftUI's `@main App` needs an app bundle/target, not a library.
2. Firebase's iOS SDK is easiest to add via Xcode's package resolution
   (it pulls in XCFrameworks that need Xcode's build system to link).

### Steps

1. **Create the Xcode project.**
   In Xcode: File > New > Project > iOS > App. Name it `Ember`, disable
   "Use Core Data" (SwiftData is set up manually here), enable SwiftUI.
2. **Drop in the source.**
   Delete the generated `ContentView.swift`/`EmberApp.swift`, then drag
   the contents of `Sources/Ember/` into the Xcode project (keep the
   folder groups), and add `Tests/EmberTests` as a Unit Testing Bundle
   target.
3. **Add Firebase.**
   File > Add Package Dependencies… > `https://github.com/firebase/firebase-ios-sdk`.
   Add these products to the Ember app target: `FirebaseAuth`,
   `FirebaseFirestore`, `FirebaseDatabase`, `FirebaseMessaging`,
   `FirebaseStorage`.
4. **Add `GoogleService-Info.plist`.**
   From your Firebase console project, download it and drag it into the
   Xcode project (do not commit it to a public repo).
5. **Uncomment the Firebase imports** in
   `Sources/Ember/Services/FirebaseChatService.swift` and implement each
   `fatalError` per the comment above it.
6. **Enable Push Notifications & Background Modes** (remote notification)
   capabilities in the target's Signing & Capabilities tab, and set up
   APNs auth key in the Firebase console for `FirebaseMessaging`.
7. **Run.**
   `⌘R` on a simulator or device running iOS 17+.

### Running just the unit tests (no Xcode / no Firebase needed)

The `VolatileChatStore` and its tests have zero Firebase or SwiftData
dependency, so once you're on a macOS machine with Xcode command line
tools:

```sh
cd Ember
swift test --filter VolatileChatStoreTests
```

(Note: this requires macOS + the Swift toolchain that ships with Xcode;
SwiftUI/Observation/SwiftData are Apple-platform-only and won't build on
Linux.)

## Security notes

- Breakout messages are encrypted in transit (Realtime Database over
  TLS by default; consider adding end-to-end encryption on top before
  shipping if that's a requirement — not implemented here).
- At-rest encryption only applies once a breakout chat is "kept" —
  promoted messages should go through the same Firestore encryption-at-
  rest handling as normal messages once `FirebaseChatService.createChat`
  is wired up.
