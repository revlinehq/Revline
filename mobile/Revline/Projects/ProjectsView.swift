import SwiftUI

struct ProjectsView: View {
    @Environment(AppSession.self) private var session
    @State private var store = ProjectsStore()
    @State private var path: [String] = []
    @State private var search = ""
    @State private var creating = false
    @State private var renaming: ProjectSummary?
    @State private var deleting: ProjectSummary?
    @State private var confirmDelete = false

    private var filtered: [ProjectSummary] {
        search.isEmpty ? store.projects : store.projects.filter { $0.title.localizedStandardContains(search) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Your workspace").font(.largeTitle.weight(.semibold)).tracking(-0.8)
                            Text("Pick up a story. Start another.").foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    if let error = store.error {
                        ErrorBanner(message: error) { store.refreshID += 1 }
                    }
                    if store.loading {
                        ProgressView("Loading projects…").frame(maxWidth: .infinity, minHeight: 280)
                    } else if store.projects.isEmpty {
                        ContentUnavailableView {
                            Label("A blank canvas", systemImage: "rectangle.stack")
                        } description: {
                            Text("Start a project and bring your first idea to life.")
                        } actions: {
                            Button("Create project", systemImage: "plus") { creating = true }
                                .buttonStyle(.bordered)
                        }
                        .frame(minHeight: 300)
                    } else if filtered.isEmpty {
                        ContentUnavailableView.search(text: search)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 155), spacing: 16)], spacing: 24) {
                            ForEach(filtered) { project in
                                NavigationLink(value: project.id) { ProjectCard(project: project) }
                                    .buttonStyle(.plain)
                                    .contextMenu {
                                        Button("Rename", systemImage: "pencil") { renaming = project }
                                        Button("Delete project", systemImage: "trash", role: .destructive) {
                                            deleting = project
                                            confirmDelete = true
                                        }
                                    }
                            }
                        }
                    }
                }
                .padding(20).frame(maxWidth: 1100).frame(maxWidth: .infinity)
            }
            .background(RevlineTheme.background)
            .navigationTitle("Revline").navigationBarTitleDisplayMode(.inline)
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
            .sheet(item: $renaming) { project in RenameProjectView(project: project, store: store) }
            .confirmationDialog("Delete “\(deleting?.title ?? "project")”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete project", role: .destructive) {
                    if let deleting { Task { await store.remove(session, project: deleting) } }
                }
            } message: {
                Text("The project will disappear immediately and its data will be permanently removed, just as on the web.")
            }
        }
    }
}
