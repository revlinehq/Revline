import SwiftUI

struct CreateProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let store: ProjectsStore
    let onCreated: (String) -> Void
    @State private var title = ""
    @State private var format = "vertical"
    @State private var error: String?
    @FocusState private var titleFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Project name", text: $title).focused($titleFocused)
                        .submitLabel(.done)
                    Picker("Canvas", selection: $format) {
                        Text("Vertical · 9:16").tag("vertical")
                        Text("Landscape · 16:9").tag("landscape")
                        Text("Square · 1:1").tag("square")
                        Text("Portrait · 4:5").tag("portrait-feed")
                        Text("Classic · 4:3").tag("classic")
                    }
                } footer: { Text("Add footage or describe what you want to make after creating your project.") }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button { Task { await create() } } label: {
                        HStack {
                            Text("Create project").fontWeight(.semibold)
                            Spacer()
                            if store.busy { ProgressView() } else { Image(systemName: "arrow.right") }
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy)
                }
            }
            .navigationTitle("New project").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { titleFocused = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(store.busy)
    }

    private func create() async {
        do {
            let id = try await store.create(session, title: title, aspectRatio: format)
            onCreated(id)
        } catch { self.error = AppFailure.describe(error) }
    }
}
