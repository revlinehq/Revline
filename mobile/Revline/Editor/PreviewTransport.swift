import SwiftUI

struct PreviewTransport: View {
    let store: ProjectStore
    @Bindable var player: PlayerController

    var body: some View {
        HStack {
            Button(player.playing ? "Pause" : "Play", systemImage: player.playing ? "pause.fill" : "play.fill", action: player.playPause)
                .labelStyle(.iconOnly).buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
                .disabled(store.timeline?.clips.isEmpty != false || !player.ready)
            Text(timecode(player.time)).font(.subheadline.monospacedDigit())
            Slider(value: $player.time, in: 0...max(0.01, store.timeline?.duration ?? 0)) { editing in
                player.scrubbing = editing
                if editing { player.pause() } else { player.seek(player.time) }
            }.accessibilityLabel("Preview position")
            Text(timecode(store.timeline?.duration ?? 0)).font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
        }.padding(.horizontal)
    }
}
