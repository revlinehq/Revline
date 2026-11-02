import SwiftUI

struct ProjectsView: View {
    @Environment(AppSession.self) private var session
    @State private var store = ProjectsStore()
    @State private var path: [String] = []
    @State private var search = ""
    @State private var creating = false
    @State private var renaming: ProjectSummary?

    private var filtered: [ProjectSummary] {
        search.isEmpty ? store.projects : store.projects.filter { $0.title.localizedStandardContains(search) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let error = store.error {
                    Section { ErrorBanner(message: error) { store.refreshID += 1 } }
                }
                Section {
                    ForEach(filtered) { project in
                        ProjectListRow(project: project, onRename: { renaming = project }) {
                            Task { await store.remove(session, project: project) }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if store.loading && store.projects.isEmpty {
                    ProgressView("Loading projects…")
                } else if store.projects.isEmpty && store.error == nil {
                    ContentUnavailableView {
                        Label("No projects yet", systemImage: "rectangle.stack")
                    } description: {
                        Text("Create a project to start your next story.")
                    } actions: {
                        Button("Create project") { creating = true }.buttonStyle(.borderedProminent)
                    }
                } else if filtered.isEmpty && !search.isEmpty {
                    ContentUnavailableView.search
                }
            }
            .navigationTitle("Projects")
            .searchable(text: $search, prompt: "Find a project")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New project", systemImage: "plus") { creating = true }
                }
            }
            .navigationDestination(for: String.self) { ProjectView(projectID: $0) }
            .refreshable { store.refreshID += 1 }
            .task(id: store.refreshID) { await store.observe(session) }
            .sheet(isPresented: $creating) {
                CreateProjectView(store: store) { id in creating = false; path.append(id) }
            }
            .sheet(item: $renaming) { RenameProjectView(project: $0, store: store) }
        }
    }
}
