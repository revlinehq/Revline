import SwiftUI

struct TimelineStrip: View {
    let timeline: TimelineDocument?
    let player: PlayerController

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 4) {
                if let timeline, !timeline.clips.isEmpty {
                    ForEach(timeline.clips.sorted { $0.start < $1.start }) { clip in
                        Button { player.seek(clip.start) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(clip.label, systemImage: symbol(clip.kind))
                                    .font(.caption2).lineLimit(1)
                                Text(clip.duration, format: .number.precision(.fractionLength(1))) + Text("s")
                            }
                            .font(.caption2.monospacedDigit())
                            .padding(8).frame(width: min(180, max(72, clip.duration * 12)), alignment: .leading)
                            .background(RevlineTheme.raised, in: .rect(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(clip.label), \(Int(clip.start)) seconds. Seek to clip.")
                    }
                } else {
                    Label("Your timeline is empty", systemImage: "rectangle.split.3x1")
                        .font(.caption).foregroundStyle(.tertiary).padding(.vertical, 12)
                }
            }.padding(.horizontal, 16)
        }
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
