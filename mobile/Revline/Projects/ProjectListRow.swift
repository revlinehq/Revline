import SwiftUI

struct ProjectListRow: View {
    let project: ProjectSummary
    let onRename: () -> Void
    let onDelete: () -> Void
    @State private var confirmingDelete = false

    var body: some View {
        NavigationLink(value: project.id) { ProjectRow(project: project) }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Delete", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                Button("Rename", systemImage: "pencil", action: onRename)
            }
            .contextMenu {
                Button("Rename", systemImage: "pencil", action: onRename)
                Button("Delete project", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            }
            .confirmationDialog("Delete “\(project.title)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete project", role: .destructive, action: onDelete)
            } message: {
                Text("This permanently deletes the project and its data. This can’t be undone.")
            }
    }
}
