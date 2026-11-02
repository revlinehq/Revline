import Foundation

struct ExportJob: Decodable, Identifiable, Sendable {
    let _id: String
    let status: String
    let progress: Double
    let resolution: Double
    let fps: Double
    let quality: String
    let createdAt: Double
    let label: String?
    let error: String?
    let url: URL?
    var id: String { _id }
    var active: Bool { status == "queued" || status == "rendering" }
}
