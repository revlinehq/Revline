import AVFoundation
@preconcurrency import ConvexMobile
import Foundation
import ImageIO
import UniformTypeIdentifiers

@MainActor
struct MediaUploader {
    let session: AppSession

    func upload(_ url: URL, projectID: String, progress: @MainActor (Double, String) -> Void) async throws -> String {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
        guard let size = values.fileSize, size > 0 else { throw AppFailure("This file is empty or unavailable.") }
        let type = values.contentType ?? UTType(filenameExtension: url.pathExtension) ?? .data
        var metadata: ConvexArguments = ["projectId": projectID, "fileName": url.lastPathComponent,
                                        "size": Double(size), "contentType": type.preferredMIMEType ?? "application/octet-stream"]
        progress(0, "Reading media…")
        if type.conforms(to: .image) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? Double,
                  let height = properties[kCGImagePropertyPixelHeight] as? Double else { throw AppFailure("This image could not be read.") }
            let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
            let rotated = (5...8).contains(orientation)
            metadata["kind"] = "image"
            metadata["width"] = rotated ? height : width
            metadata["height"] = rotated ? width : height
        } else if type.conforms(to: .movie) || type.conforms(to: .audio) {
            let asset = AVURLAsset(url: url)
            let duration = try await asset.load(.duration).seconds
            guard duration.isFinite, duration > 0 else { throw AppFailure("This media has no readable duration.") }
            metadata["duration"] = duration
            if let track = try await asset.loadTracks(withMediaType: .video).first {
                let naturalSize = try await track.load(.naturalSize)
                let transform = try await track.load(.preferredTransform)
                let size = naturalSize.applying(transform)
                metadata["kind"] = "video"
                metadata["width"] = Double(abs(size.width).rounded())
                metadata["height"] = Double(abs(size.height).rounded())
            } else { metadata["kind"] = "audio" }
        } else { throw AppFailure("Choose a video, image, or audio file.") }
        try Task.checkCancellation()
        let upload: UploadReservation = try await session.client.action("r2:start", with: metadata)
        var completed = false
        do {
            guard upload.partSize > 0, upload.partSize <= 100 * 1024 * 1024 else { throw AppFailure("The upload server returned an invalid part size.") }
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var parts: [UploadedPart] = []
            var bytesSent = 0
            for partNumber in 1...upload.partCount {
                try Task.checkCancellation()
                let signedURL: String = try await session.client.action("r2:partUrl", with: ["uploadId": upload.uploadId, "partNumber": Double(partNumber)])
                guard let partURL = URL(string: signedURL), let data = try handle.read(upToCount: upload.partSize), !data.isEmpty else {
                    throw AppFailure("Could not read the next part of this file.")
                }
                var request = URLRequest(url: partURL)
                request.httpMethod = "PUT"
                request.timeoutInterval = 600
                request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                let (responseData, response) = try await URLSession.shared.upload(for: request, from: data)
                guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                    throw AppFailure("The upload was interrupted. Try importing the file again.")
                }
                let part = try JSONDecoder().decode(UploadedPart.self, from: responseData)
                guard part.partNumber == partNumber, !part.etag.isEmpty else { throw AppFailure("The server did not confirm this upload part.") }
                parts.append(part)
                bytesSent += data.count
                progress(Double(bytesSent) / Double(size), "Uploading \(url.lastPathComponent)…")
            }
            try Task.checkCancellation()
            progress(1, "Saving media…")
            let result: String? = try await session.client.action("r2:complete", with: [
                "uploadId": upload.uploadId,
                "parts": JSONValue.array(parts.map { .object(["partNumber": .number(Double($0.partNumber)), "etag": .string($0.etag)]) })
            ])
            completed = true
            guard let result else { throw AppFailure("The server did not return the imported media.") }
            return result
        } catch {
            if !completed { try? await session.client.action("r2:abort", with: ["uploadId": upload.uploadId]) }
            throw error
        }
    }
}

private struct UploadReservation: Decodable {
    let uploadId: String
    let partSize: Int
    let partCount: Int
}

private struct UploadedPart: Decodable {
    let partNumber: Int
    let etag: String
}
