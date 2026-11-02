@preconcurrency import ConvexMobile
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct MediaLibraryView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var photos: [PhotosPickerItem] = []
    @State private var files = false
    @State private var link = ""
    @State private var importingLink = false
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Import") {
                    PhotosPicker(selection: $photos, maxSelectionCount: 20, matching: .any(of: [.videos, .images])) {
                        Label("Choose from Photos", systemImage: "photo.on.rectangle")
                    }.disabled(store.importProgress != nil)
                    Button("Choose from Files", systemImage: "folder") { files = true }
                        .disabled(store.importProgress != nil)
                }
                Section {
                    TextField("Paste a video link", text: $link)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button { Task { await importLink() } } label: {
                        HStack { Label("Import video link", systemImage: "link"); Spacer(); if importingLink { ProgressView() } }
                    }.disabled(importingLink || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } footer: { Text("Imported media is available to the agent. Attach a source below, then describe how you want to use it.") }
                if let progress = store.importProgress {
                    Section {
                        ProgressView(value: progress) { Text(store.importLabel).font(.footnote) }
                        Button("Cancel upload", role: .destructive) { store.uploadTask?.cancel() }
                    }
                }
                if let error = localError ?? store.error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
                let activeTasks = store.mediaTasks.filter(\.active)
                if !activeTasks.isEmpty {
                    Section("Processing") {
                        ForEach(activeTasks) { task in
                            ProgressView(value: task.progress, total: 100) {
                                Text(task.kind == "import" ? "Importing video…" : "Preparing media…").font(.footnote)
                            }
                        }
                    }
                }
                Section("Project media") {
                    if store.assets.isEmpty { Text("Your imported media will appear here.").foregroundStyle(.secondary).font(.subheadline) }
                    ForEach(store.assets) { asset in
                        Button {
                            if store.attachedAssetIDs.contains(asset.id) { store.attachedAssetIDs.removeAll { $0 == asset.id } }
                            else if store.attachedAssetIDs.count < 20 { store.attachedAssetIDs.append(asset.id) }
                        } label: {
                            HStack(spacing: 12) {
                                MediaThumbnail(url: asset.thumbnailUrl ?? asset.url, kind: asset.thumbnailUrl == nil ? asset.kind : "image")
                                    .frame(width: 64, height: 48).clipShape(.rect(cornerRadius: 6))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(asset.fileName).font(.subheadline).lineLimit(1)
                                    Text(asset.preparation?.message ?? asset.kind.capitalized).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: store.attachedAssetIDs.contains(asset.id) ? "checkmark.circle.fill" : "plus.circle")
                            }
                        }.buttonStyle(.plain)
                            .accessibilityLabel("\(asset.fileName), \(store.attachedAssetIDs.contains(asset.id) ? "attached" : "attach to prompt")")
                    }
                }
            }
            .navigationTitle("Media").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .fileImporter(isPresented: $files, allowedContentTypes: [.movie, .image, .audio], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): beginUpload(urls, removeAfter: false)
                case .failure(let error): localError = AppFailure.describe(error)
                }
            }
            .onChange(of: photos) { _, selection in
                guard !selection.isEmpty else { return }
                beginPhotoUpload(selection)
                photos = []
            }
        }
    }

    private func beginPhotoUpload(_ selection: [PhotosPickerItem]) {
        guard store.importProgress == nil else { return }
        store.error = nil
        store.importProgress = 0
        store.importLabel = "Reading from Photos…"
        store.uploadTask = Task {
            defer { store.importProgress = nil; store.uploadTask = nil }
            do {
                for item in selection {
                    try Task.checkCancellation()
                    guard let file = try await item.loadTransferable(type: TransferredMedia.self) else {
                        throw AppFailure("This item could not be read from Photos.")
                    }
                    defer { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }
                    let id = try await MediaUploader(session: session).upload(file.url, projectID: store.id) { progress, label in
                        store.importProgress = progress; store.importLabel = label
                    }
                    if store.attachedAssetIDs.count < 20 { store.attachedAssetIDs.append(id) }
                }
            } catch { if !Task.isCancelled { store.error = AppFailure.describe(error) } }
        }
    }

    private func beginUpload(_ urls: [URL], removeAfter: Bool) {
        guard store.importProgress == nil, !urls.isEmpty else { return }
        store.error = nil
        store.importProgress = 0
        store.uploadTask = Task {
            defer {
                store.importProgress = nil; store.uploadTask = nil
                if removeAfter { for url in urls { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) } }
            }
            do {
                for url in urls {
                    let id = try await MediaUploader(session: session).upload(url, projectID: store.id) { progress, label in
                        store.importProgress = progress; store.importLabel = label
                    }
                    if store.attachedAssetIDs.count < 20 { store.attachedAssetIDs.append(id) }
                }
            } catch { if !Task.isCancelled { store.error = AppFailure.describe(error) } }
        }
    }

    private func importLink() async {
        importingLink = true; localError = nil
        defer { importingLink = false }
        do {
            let _: JSONValue = try await session.client.mutation("mediaTasks:importVideo", with: ["projectId": store.id, "url": link])
            link = ""
        } catch { localError = AppFailure.describe(error) }
    }
}
