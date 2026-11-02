import SwiftUI

struct WorkspaceTabs: View {
    var body: some View {
        if #available(iOS 18.0, *) {
            TabView {
                Tab("Projects", systemImage: "rectangle.stack") { ProjectsView() }
                Tab("Account", systemImage: "person.crop.circle") { SettingsView() }
            }
        } else {
            TabView {
                ProjectsView().tabItem { Label("Projects", systemImage: "rectangle.stack") }
                SettingsView().tabItem { Label("Account", systemImage: "person.crop.circle") }
            }
        }
    }
}
