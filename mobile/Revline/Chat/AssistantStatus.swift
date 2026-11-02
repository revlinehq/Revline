import Foundation

struct AssistantStatus: Decodable, Sendable {
    let configured: Bool
    let mobileConfigured: Bool?
    let running: Bool
    let editing: Bool
    let error: String?
    let reason: String?
    let activity: String?
    let activitySource: String?
    let modelSwitcher: Bool?
    let allowedModels: [String]?
    let defaultModelChoice: String?
    let externalAgent: ExternalAgent?

    var unavailableReason: String? { mobileConfigured == true ? nil : reason }

    struct ExternalAgent: Decodable, Sendable {
        let name: String
        let running: Bool
    }
}

struct AssistantQueue: Decodable, Sendable {
    let messages: [QueuedPrompt]
    let paused: Bool
}

struct QueuedPrompt: Decodable, Identifiable, Sendable {
    let id: String
    let prompt: String
    let error: String?
}
