// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Ember",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(name: "Ember", targets: ["Ember"])
    ],
    dependencies: [
        // Firebase is added via Xcode's built-in SPM integration once the
        // project is opened in Xcode (Firebase's package resolution is
        // easier through Xcode's UI than a bare `swift build`, and Firebase
        // ships XCFrameworks that need an Xcode target to link against).
        //
        //   File > Add Package Dependencies…
        //   https://github.com/firebase/firebase-ios-sdk
        //
        // Required products: FirebaseAuth, FirebaseFirestore,
        // FirebaseMessaging, FirebaseStorage, FirebaseDatabase (for the
        // volatile-chat realtime channel).
    ],
    targets: [
        .target(
            name: "Ember",
            dependencies: [],
            path: "Sources/Ember"
        ),
        .testTarget(
            name: "EmberTests",
            dependencies: ["Ember"],
            path: "Tests/EmberTests"
        )
    ]
)
