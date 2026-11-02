import Foundation

struct ProjectDocument: Decodable, Sendable {
    let _id: String
    let title: String
    let aspectRatio: String
    let timeline: TimelineDocument?
    let threadId: String?
    let activeTimelineId: String?
    let revision: Double?
}

struct TimelineDocument: Decodable, Sendable {
    let clips: [TimelineClip]
    let fps: Double
    let aspectRatio: String
    var duration: Double { clips.map { $0.start + $0.duration }.max() ?? 0 }
}

struct TimelineClip: Decodable, Identifiable, Sendable {
    let id: String
    let kind: String
    let start: Double
    let duration: Double
    let track: Double?
    let text: String?
    let name: String?
    let assetId: String?
    var label: String { name ?? text ?? kind.capitalized }
}

struct TimelineTab: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let active: Bool
    let duration: Double
    let clipCount: Int
}

struct TimelineSnapshot: Decodable, Sendable {
    let id: String
    let timeline: TimelineDocument
}
