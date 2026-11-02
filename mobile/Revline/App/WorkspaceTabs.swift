import SwiftUI

struct WorkspaceTabs: View {
    @State private var selectedTab = WorkspaceTab.projects
    @State private var previousTab = WorkspaceTab.projects
    @State private var creating = false
    @State private var projects = ProjectsStore()
    @State private var projectPath: [String] = []

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                TabView(selection: $selectedTab) {
                    Tab("Projects", systemImage: "rectangle.stack", value: .projects) {
                        ProjectsView(store: projects, path: $projectPath) { creating = true }
                    }
                    Tab("Account", systemImage: "person.crop.circle", value: .account) { SettingsView() }
                    Tab("New project", systemImage: "plus", value: .create, role: .search) { Color.clear }
                }
            } else if #available(iOS 18.0, *) {
                TabView(selection: $selectedTab) {
                    Tab("Projects", systemImage: "rectangle.stack", value: .projects) {
                        ProjectsView(store: projects, path: $projectPath) { creating = true }
                    }
                    Tab("Account", systemImage: "person.crop.circle", value: .account) { SettingsView() }
                    Tab("New project", systemImage: "plus", value: .create) { Color.clear }
                }
            } else {
                TabView(selection: $selectedTab) {
                    ProjectsView(store: projects, path: $projectPath) { creating = true }
                        .tabItem { Label("Projects", systemImage: "rectangle.stack") }.tag(WorkspaceTab.projects)
                    SettingsView().tabItem { Label("Account", systemImage: "person.crop.circle") }.tag(WorkspaceTab.account)
                    Color.clear.tabItem { Label("New project", systemImage: "plus") }.tag(WorkspaceTab.create)
                }
            }
        }
        .toolbar(projectPath.isEmpty || selectedTab == .account ? .visible : .hidden, for: .tabBar)
        .onChange(of: selectedTab) { _, tab in
            if tab == .create {
                selectedTab = previousTab
                creating = true
            } else { previousTab = tab }
        }
        .sheet(isPresented: $creating) {
            CreateProjectView(store: projects, onCreated: openProject)
        }
    }

    private func openProject(_ id: String) {
        creating = false
        selectedTab = .projects
        projectPath.append(id)
    }
}
