import SwiftUI

struct RenameProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let project: ProjectSummary
    let store: ProjectsStore
    @State private var title: String
    @State private var saving = false

    init(project: ProjectSummary, store: ProjectsStore) {
        self.project = project
        self.store = store
        _title = State(initialValue: project.title)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Project name", text: $title)
                if let error = store.error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Rename project").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saving = true
                        store.error = nil
                        Task {
                            await store.rename(session, project: project, title: title)
                            saving = false
                            if store.error == nil { dismiss() }
                        }
                    }
                    .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
