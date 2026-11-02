@preconcurrency import ConvexMobile
import Foundation
import Observation
import Photos

@MainActor @Observable
final class NativeExportStore {
    var busy = false
    var progress = 0.0
    var status = "Rendering…"
    var error: String?
    var notice: String?
    var share: ExportFile?
    private var task: Task<Void, Never>?

    func stopObserving() { task?.cancel(); task = nil }

    func start(session: AppSession, project: ProjectStore, destination: ExportDestination, resolution: Double, fps: Double, captions: Bool) {
        guard !busy else { return }
        busy = true; error = nil; notice = nil; progress = 0; status = "Starting export…"
        task = Task {
            defer { busy = false }
            do {
                var args: ConvexArguments = ["projectId": project.id, "timelineId": project.timelineID,
                    "resolution": resolution, "fps": fps, "quality": "standard", "burnCaptions": captions]
                let id: String
                do { id = try await session.client.mutation("renders:start", with: args) }
                catch {
                    guard captions, String(describing: error).contains("extra field `burnCaptions`") else { throw error }
                    args.removeValue(forKey: "burnCaptions")
                    id = try await session.client.mutation("renders:start", with: args)
                }
                for try await job in session.client.subscribe(to: "renders:get", with: ["jobId": id], yielding: ExportJob.self).values {
                    try Task.checkCancellation()
                    progress = job.progress
                    status = job.status == "queued" ? "Queued for export…" : "Rendering…"
                    if job.status == "failed" || job.status == "cancelled" { throw AppFailure(job.error ?? "The export did not complete. Try again.") }
                    if job.status == "completed" {
                        status = "Preparing video…"
                        try await deliver(session: session, jobID: id, destination: destination)
                        break
                    }
                }
            } catch is CancellationError { }
            catch { self.error = AppFailure.describe(error) }
        }
    }

    private func deliver(session: AppSession, jobID: String, destination: ExportDestination) async throws {
        let signed: String = try await session.client.action("renders:download", with: ["jobId": jobID])
        guard let url = URL(string: signed), url.scheme == "https" else { throw AppFailure("The video download is unavailable.") }
        let (temporary, response) = try await URLSession.shared.download(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw AppFailure("The video could not be downloaded.") }
        let file = URL.temporaryDirectory.appending(path: "Revline-\(UUID().uuidString).mp4")
        try FileManager.default.moveItem(at: temporary, to: file)
        if destination == .photos {
            defer { try? FileManager.default.removeItem(at: file) }
            let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard permission == .authorized || permission == .limited else { throw AppFailure("Allow Revline to add videos in Settings, or choose Files to share your export.") }
            try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file) }
            notice = "Saved to Photos."
        } else {
            // TikTok uses the system share sheet. No third-party SDK or account access.
            share = ExportFile(url: file)
            notice = destination == .tikTok ? "Choose TikTok in the share sheet if it is installed." : "Choose Save to Files in the share sheet."
        }
    }
}
