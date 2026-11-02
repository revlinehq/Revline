import SwiftUI

struct ExportSheet: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let onClose: () -> Void
    @State private var destination = ExportDestination.photos
    @State private var resolution = 1080.0
    @State private var fps = 30.0
    @State private var captions = true
    @State private var confirming = false
    @State private var export = NativeExportStore()
    @State private var history = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                HStack {
                    Text("Export").font(.title).bold()
                    Spacer()
                    Menu {
                        Picker("Resolution", selection: $resolution) {
                            Text("720p").tag(720.0)
                            Text("1080p").tag(1080.0)
                        }
                        Picker("Frame rate", selection: $fps) {
                            ForEach([24.0, 30.0, 60.0], id: \.self) { Text("\(Int($0)) fps").tag($0) }
                        }
                    } label: {
                        Label("\(String(Int(resolution)))p · \(String(Int(fps))) fps", systemImage: "chevron.down")
                            .font(.subheadline.monospacedDigit())
                    }.buttonStyle(.borderless).frame(minHeight: 44).disabled(export.busy)
                    Button("Close export", systemImage: "xmark", action: onClose)
                        .labelStyle(.iconOnly).buttonStyle(.borderless).frame(width: 44, height: 44)
                }
                HStack(spacing: 10) {
                    ForEach(ExportDestination.allCases) { item in
                        Button { destination = item } label: {
                            VStack(spacing: 10) {
                                Image(systemName: item.symbol).font(.title2)
                                Text(item.rawValue).font(.subheadline)
                                if destination == item { Image(systemName: "checkmark.circle.fill").font(.caption) }
                            }
                            .frame(maxWidth: .infinity, minHeight: 88)
                        }
                        .buttonStyle(.bordered).buttonBorderShape(.roundedRectangle(radius: 20))
                        .tint(destination == item ? .accentColor : .secondary)
                        .accessibilityAddTraits(destination == item ? .isSelected : [])
                        .disabled(export.busy)
                    }
                }
                Toggle("Burn in captions", isOn: $captions).tint(.accentColor).disabled(export.busy)
                if export.busy {
                    ProgressView(export.status, value: export.progress, total: 100)
                    Text("You can keep editing while Revline renders.").font(.footnote).foregroundStyle(Color.secondary)
                }
                if let error = export.error { ErrorBanner(message: error) }
                if let notice = export.notice { Text(notice).font(.subheadline).foregroundStyle(Color.secondary) }
                Button { confirming = true } label: {
                    ActionLabel(title: "Save \(timecode(store.timeline?.duration ?? 0)) video", busyTitle: export.status, busy: export.busy)
                }
                .buttonStyle(.borderedProminent).controlSize(.large).buttonBorderShape(.capsule)
                .tint(.accentColor).disabled(export.busy || store.timeline?.clips.isEmpty != false)
                .confirmationDialog("Start this export?", isPresented: $confirming, titleVisibility: .visible) {
                    Button("Render and save video") {
                        export.start(session: session, project: store, destination: destination, resolution: resolution, fps: fps, captions: captions)
                    }
                } message: { Text("Revline will render the saved timeline. Your original media and edit stay unchanged.") }
                Button("Recent exports") { history = true }.buttonStyle(.borderless).frame(minHeight: 44)
            }
            .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 16)
        }
        .background(Color.revlineCard)
        .sheet(item: $export.share) { ShareSheet(url: $0.url) }
        .sheet(isPresented: $history) { ExportsView(store: store) }
        .onDisappear { export.stopObserving() }
    }
}
