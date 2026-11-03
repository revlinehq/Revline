import AVFoundation
import SwiftUI

struct MediaThumbnail: View {
    let url: URL?
    var kind: String? = "image"
    @State private var frame: UIImage?

    var body: some View {
        Rectangle().fill(Color.revlinePopover).overlay {
            if let frame {
                Image(uiImage: frame).resizable().scaledToFill()
            } else if let url, kind != "video" {
                AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { placeholder }
            } else { placeholder }
        }
        .clipped()
        .accessibilityHidden(true)
        .task(id: url) {
            frame = nil
            guard kind == "video", let url else { return }
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 640, height: 640)
            do {
                let result = try await generator.image(at: .zero)
                try Task.checkCancellation()
                frame = UIImage(cgImage: result.image)
            } catch { generator.cancelAllCGImageGeneration() }
        }
    }

    private var placeholder: some View {
        Image(systemName: kind == "audio" ? "waveform" : "play.rectangle")
            .font(.title2).foregroundStyle(Color.secondary)
    }
}
