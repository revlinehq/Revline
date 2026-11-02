import SwiftUI

struct RenameProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let project: ProjectSummary
    let store: ProjectsStore
    @State private var title: String
    @State private var saving = false
    @FocusState private var focused: Bool

    init(project: ProjectSummary, store: ProjectsStore) {
        self.project = project
        self.store = store
        _title = State(initialValue: project.title)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Project name") {
                    TextField("Project name", text: $title)
                        .focused($focused).submitLabel(.done).onSubmit(saveIfPossible)
                }.revlineRows()
                if let error = store.error { Section { ErrorBanner(message: error) }.revlineRows() }
                Section {
                    Button(action: save) {
                        ActionLabel(title: "Save changes", busyTitle: "Saving…", busy: saving)
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!canSave)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            }
            .revlineSurface(.revlinePopover)
            .navigationTitle("Rename project").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: dismiss.callAsFunction) } }
            .task { focused = true }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Color.revlinePopover)
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(saving)
    }

    private var canSave: Bool { !saving && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title != project.title }
    private func saveIfPossible() { if canSave { save() } }

    private func save() {
        saving = true
        store.error = nil
        Task {
            await store.rename(session, project: project, title: title)
            saving = false
            if store.error == nil { dismiss() }
        }
    }
}
