import SwiftUI

struct TimelineStrip: View {
    let timeline: TimelineDocument?
    let player: PlayerController
    @ScaledMetric(relativeTo: .subheadline) private var stripHeight = 88

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 8) {
                if let timeline, !timeline.clips.isEmpty {
                    ForEach(timeline.clips.sorted { $0.start < $1.start }) { clip in
                        Button { player.seek(clip.start) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(clip.label, systemImage: symbol(clip.kind))
                                    .font(.subheadline).lineLimit(1)
                                Text("\(clip.duration, format: .number.precision(.fractionLength(1)))s")
                            }
                            .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                            .padding(12).frame(width: min(200, max(124, clip.duration * 12)), alignment: .leading).frame(minHeight: 64)

                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("\(clip.label), \(Int(clip.start)) seconds. Seek to clip.")
                    }
                } else {
                    Label("Your timeline is empty", systemImage: "rectangle.split.3x1")
                        .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 16)
                }
            }.padding(.horizontal, 16).padding(.vertical, 4)
        }
        .frame(height: stripHeight)
        .scrollIndicators(.hidden)
        .accessibilityLabel("Read-only timeline")
    }

    private func symbol(_ kind: String) -> String {
        switch kind {
        case "audio": "waveform"
        case "scene": "square.stack.3d.up"
        case "caption", "graphic": "textformat"
        case "image": "photo"
        default: "film"
        }
    }
}
