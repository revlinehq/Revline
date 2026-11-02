import SwiftUI

enum ExportDestination: String, CaseIterable, Identifiable {
    case photos = "Photos", tikTok = "TikTok", files = "Files"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .photos: "photo"
        case .tikTok: "music.note"
        case .files: "folder"
        }
    }
}
