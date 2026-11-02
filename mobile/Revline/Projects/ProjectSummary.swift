import Foundation

struct ProjectSummary: Decodable, Identifiable, Hashable, Sendable {
    let _id: String
    let title: String
    let updatedAt: Double
    let aspectRatio: String
    let clipCount: Int
    let aiRunning: Bool
    let coverUrl: URL?
    let coverKind: String?
    var id: String { _id }
    var updatedDate: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}
