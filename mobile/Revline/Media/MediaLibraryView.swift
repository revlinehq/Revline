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
    @FocusState private var linkFocused: Bool

    var body: some View {
        if !session.aiConsentGranted {
            AIConsentView(dismissOnCompletion: false)
        } else {
        NavigationStack {
            List {
                Section("Import") {
                    PhotosPicker(selection: $photos, maxSelectionCount: 20, matching: .any(of: [.videos, .images])) {
                        Label("Choose from Photos", systemImage: "photo.on.rectangle")
                    }.disabled(store.importProgress != nil)
                    Button("Choose from Files", systemImage: "folder") { files = true }
                        .disabled(store.importProgress != nil)
                }.revlineRows()
                Section {
                    TextField("Paste a video link", text: $link)
                        .keyboardType(.URL).textContentType(.URL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($linkFocused).submitLabel(.go).onSubmit(importLinkIfPossible)
                    Button { Task { await importLink() } } label: {
                        if importingLink { ProgressView("Importing…") }
                        else { Label("Import video link", systemImage: "link") }
                    }.disabled(!canImportLink)
                } header: { Text("Video link") } footer: {
                    Text("Attach a source to your prompt, then describe how to use it.")
                }
                .revlineRows()
                if let progress = store.importProgress {
                    Section {
                        ProgressView(store.importLabel, value: progress)
                        Button("Cancel upload", role: .destructive) { store.uploadTask?.cancel() }
                    }.revlineRows()
                }
                if let error = localError ?? store.error { Section { ErrorBanner(message: error) }.revlineRows() }
                if store.mediaTasks.contains(where: \.active) {
                    Section("Processing") {
                        ForEach(store.mediaTasks.filter(\.active)) { task in
                            ProgressView(value: task.progress, total: 100) {
                                Text(task.kind == "import" ? "Importing video…" : "Preparing media…")
                            }
                        }
                    }.revlineRows()
                }
                Section("Project media") {
                    if store.assets.isEmpty {
                        ContentUnavailableView("No media yet", systemImage: "photo.on.rectangle", description: Text("Import footage from Photos, Files, or a link."))
                    }
                    ForEach(store.assets) { asset in
                        Button { toggleAttachment(asset.id) } label: {
                            MediaAssetRow(asset: asset, attached: store.attachedAssetIDs.contains(asset.id))
                        }
                        .foregroundStyle(Color.primary)
                        .accessibilityLabel("\(asset.fileName), \(store.attachedAssetIDs.contains(asset.id) ? "attached" : "attach to prompt")")
                    }
                }.revlineRows()
            }
            .listStyle(.insetGrouped)
            .revlineSurface(.revlinePopover)
            .navigationTitle("Media").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: dismiss.callAsFunction) } }
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
        .presentationBackground(Color.revlinePopover)
        }
    }

    private var canImportLink: Bool { !importingLink && !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private func importLinkIfPossible() { if canImportLink { Task { await importLink() } } }

    private func toggleAttachment(_ id: String) {
        if store.attachedAssetIDs.contains(id) { store.attachedAssetIDs.removeAll { $0 == id } }
        else if store.attachedAssetIDs.count < 20 { store.attachedAssetIDs.append(id) }
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
