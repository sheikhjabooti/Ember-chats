import Foundation

/// Distinguishes the three conversation shapes Ember supports.
/// `.breakout` is the only kind that can be non-persisted at rest.
public enum ChatKind: String, Codable, Sendable, CaseIterable {
    case direct
    case group
    case breakout
}
