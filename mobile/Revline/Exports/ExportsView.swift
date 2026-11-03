@preconcurrency import ConvexMobile
import Photos
import SwiftUI

struct ExportsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var resolution = 1080.0
    @State private var fps = 60.0
    @State private var quality = "standard"
    @State private var confirming = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var share: ExportFile?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent(store.project?.title ?? "Project") { Text(timecode(store.timeline?.duration ?? 0)).foregroundStyle(Color.primary).monospacedDigit() }
                    if store.tabs.count > 1 { Text(store.tabs.first { $0.id == store.timelineID }?.name ?? "Selected timeline").font(.subheadline).foregroundStyle(Color.secondary) }
                    Picker("Resolution", selection: $resolution) {
                        Text("720p").tag(720.0)
                        Text("1080p").tag(1080.0)
                        if session.purchases.status?.plan == "ultra" { Text("4K · Ultra").tag(2160.0) }
                    }
                    Picker("Frame rate", selection: $fps) {
                        ForEach([24.0, 30.0, 60.0], id: \.self) { Text("\(Int($0)) fps").tag($0) }
                    }
                    Picker("Quality", selection: $quality) {
                        Text("Standard").tag("standard")
                        Text("High").tag("high")
                    }
                }.revlineRows()
                Section {
                    Button { confirming = true } label: {
                        ActionLabel(title: "Export MP4", busyTitle: "Starting export…", busy: busy)
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(busy || store.timeline?.clips.isEmpty != false)
                    .confirmationDialog("Start this export?", isPresented: $confirming, titleVisibility: .visible) {
                        Button("Export \(Int(resolution))p MP4") { Task { await start() } }
                    } message: { Text("Revline will render the saved version of this timeline at \(Int(fps)) fps. You can keep editing while it runs.") }
                } footer: { Text("Exports run in the cloud. You can keep editing while they render.") }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                if let error { Section { ErrorBanner(message: error) }.listRowBackground(Color.clear).listRowInsets(EdgeInsets()) }
                if let notice { Section { Text(notice).font(.subheadline).foregroundStyle(Color.secondary) }.revlineRows() }
                Section("Recent exports") {
                    if store.exports.isEmpty { ContentUnavailableView("No exports yet", systemImage: "square.and.arrow.up", description: Text("Export a timeline to save or share it.")) }
                    ForEach(store.exports) { job in
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text(job.label ?? "\(Int(job.resolution))p · \(Int(job.fps)) fps").font(.headline)
                                Spacer()
                                Text(job.status.capitalized).font(.subheadline).foregroundStyle(Color.secondary)
                            }
                            if job.active {
                                ProgressView(value: job.progress, total: 100)
                                Button("Cancel export", role: .destructive) {
                                    Task { await store.mutate(session, "renders:cancel", arguments: ["jobId": job.id]) }
                                }.buttonStyle(.borderless)
                            } else if job.status == "completed" {
                                VStack(spacing: 8) {
                                    Button("Share", systemImage: "square.and.arrow.up") { Task { await download(job, saveToPhotos: false) } }
                                    Button("Save to Photos", systemImage: "square.and.arrow.down") { Task { await download(job, saveToPhotos: true) } }
                                }.buttonStyle(.bordered).controlSize(.large).disabled(busy)
                            }
                            if let error = job.error { Text(error).font(.subheadline).foregroundStyle(.red) }
                        }.padding(.vertical, 12)
                    }
                }.revlineRows()
            }
            .listStyle(.insetGrouped)
            .revlineSurface(.revlinePopover)
            .navigationTitle("Exports").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $share) { ShareSheet(url: $0.url) }
            .task { fps = [24.0, 30.0].contains(store.timeline?.fps ?? 0) ? store.timeline?.fps ?? 60 : 60 }
        }
        .presentationBackground(Color.revlinePopover)
    }

    private func start() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let _: String = try await session.client.mutation("renders:start", with: ["projectId": store.id,
                "resolution": resolution, "fps": fps, "quality": quality, "timelineId": store.timelineID])
        } catch { self.error = AppFailure.describe(error) }
    }

    private func download(_ job: ExportJob, saveToPhotos: Bool) async {
        busy = true; error = nil; notice = nil
        defer { busy = false }
        do {
            let signedURL: String = try await session.client.action("renders:download", with: ["jobId": job.id])
            guard let url = URL(string: signedURL), url.scheme == "https" else { throw AppFailure("The download link is unavailable.") }
            let (temporary, response) = try await URLSession.shared.download(from: url)
            guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw AppFailure("The export could not be downloaded. Try again.") }
            let directory = FileManager.default.temporaryDirectory.appending(path: "RevlineExports")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appending(path: "Revline-\(job.id).mp4")
            try? FileManager.default.removeItem(at: file)
            try FileManager.default.moveItem(at: temporary, to: file)
            if saveToPhotos {
                let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard permission == .authorized || permission == .limited else { throw AppFailure("Allow Revline to add videos in Settings, or use Share to save this export.") }
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file) }
                notice = "Saved to Photos."
                try? FileManager.default.removeItem(at: file)
            } else { share = ExportFile(url: file) }
        } catch { self.error = AppFailure.describe(error) }
    }
}
