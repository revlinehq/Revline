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

    private var canCreate: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.busy }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Project name", text: $title)
                        .autocorrectionDisabled().focused($titleFocused).submitLabel(.done)
                        .onSubmit { if canCreate { Task { await create() } } }
                    Picker("Canvas", selection: $format) {
                        Text("Vertical · 9:16").tag("vertical")
                        Text("Landscape · 16:9").tag("landscape")
                        Text("Square · 1:1").tag("square")
                        Text("Portrait · 4:5").tag("portrait-feed")
                        Text("Classic · 4:3").tag("classic")
                    }
                } footer: {
                    Text("Add footage or describe your first idea after creating the project.")
                }
                .revlineRows()
                if let error { Section { ErrorBanner(message: error) }.revlineRows() }
                Section {
                    Button { Task { await create() } } label: {
                        ActionLabel(title: "Create project", busyTitle: "Creating…", busy: store.busy)
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!canCreate)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            .formStyle(.grouped)
            .revlineSurface(.revlinePopover)
            .navigationTitle("New project").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: dismiss.callAsFunction) } }
            .task { titleFocused = true }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Color.revlinePopover)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(store.busy)
    }

    private func create() async {
        guard canCreate else { return }
        do {
            let id = try await store.create(session, title: title, aspectRatio: format)
            onCreated(id)
        } catch { self.error = AppFailure.describe(error) }
    }
}
