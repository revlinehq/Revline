import SwiftUI

struct ProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var store: ProjectStore
    @State private var player = PlayerController()
    @State private var drawer = AgentDrawerState()
    @State private var dismissKeyboard = 0

    init(projectID: String) { _store = State(initialValue: ProjectStore(id: projectID)) }

    var body: some View {
        GeometryReader { geometry in
            let sidebar = horizontalSizeClass == .regular && geometry.size.width >= 760
            let layout = sidebar ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                ProjectWorkspacePreview(store: store, player: player, showsTransport: !drawer.composing || sidebar) {
                    dismissKeyboard += 1
                }
                Group {
                    if drawer.exporting { ExportSheet(store: store, onClose: drawer.closeExport) }
                    else {
                        AgentSheet(store: store, player: player, drawer: drawer, dismissKeyboard: dismissKeyboard, isSidebar: sidebar)
                    }
                }
                .frame(
                    width: sidebar ? min(440, max(320, geometry.size.width * 0.4)) : nil,
                    height: sidebar ? nil : drawer.height(in: geometry.size.height)
                )
                .background(!sidebar && drawer.composing ? Color.revlineBackground : Color.revlineCard)
                .clipShape(.rect(topLeadingRadius: sidebar ? 0 : 32, topTrailingRadius: sidebar ? 0 : 32))
                .overlay(alignment: .leading) {
                    if sidebar { Rectangle().fill(Color.revlineBorder).frame(width: 1) }
                }
            }
        }
        .background(Color.revlineBackground.ignoresSafeArea())
        .toolbar(.hidden, for: .tabBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.left", action: goBack).labelStyle(.iconOnly)
            }
            if !drawer.exporting {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Export") { dismissKeyboard += 1; drawer.showExport() }
                        .buttonStyle(.borderedProminent).tint(.accentColor)
                }
            }
        }
        .task(id: store.refreshID) { store.observe(session) }
        .onChange(of: store.timelineID) { _, id in player.selectTimeline(id) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player.pause() }
            else { Task { await player.authenticate(session) } }
        }
        .onDisappear { player.pause(); store.disconnect() }
    }

    private func goBack() {
        if drawer.exporting { drawer.closeExport() }
        else { dismiss() }
    }
}
