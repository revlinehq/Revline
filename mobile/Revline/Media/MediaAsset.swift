import Foundation

struct MediaAsset: Decodable, Identifiable, Sendable {
    let _id: String
    let fileName: String
    let kind: String
    let url: URL?
    let thumbnailUrl: URL?
    let duration: Double?
    let size: Double?
    let preparation: Preparation?
    var id: String { _id }

    struct Preparation: Decodable, Sendable {
        let status: String
        let message: String
    }
}

struct MediaTaskState: Decodable, Identifiable, Sendable {
    let _id: String
    let kind: String
    let status: String
    var progress: Double
    let error: String?
    let activity: String?
    var id: String { _id }
    var active: Bool { ["queued", "running", "retrying"].contains(status) }
}

struct MediaTaskProgress: Decodable, Sendable {
    let taskId: String
    let progress: Double
}
