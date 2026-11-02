import ConvexMobile

// Convex documents its Rust-backed client as thread-safe, but 0.8.2 lacks this conformance.
// Keep this compatibility declaration until the SDK declares Sendable itself.
extension ConvexClient: @retroactive @unchecked Sendable {}
