import SwiftUI

struct ProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: ProjectStore
    @State private var player = PlayerController()
    @State private var drawer = AgentDrawerState()
    @State private var dismissKeyboard = 0

    init(projectID: String) { _store = State(initialValue: ProjectStore(id: projectID)) }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                if store.project != nil {
                    ProjectPreview(store: store, player: player)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(.rect)
                        .simultaneousGesture(TapGesture().onEnded { dismissKeyboard += 1 })
                    if !drawer.composing { PreviewTransport(store: store, player: player) }
                } else if let error = store.error {
                    WorkspaceStateView(title: "Couldn’t open project", description: error, symbol: "wifi.slash", actionTitle: "Try again") { store.refreshID += 1 }
                } else { WorkspaceStateView(title: "Opening project…", loading: true) }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Group {
                    if drawer.exporting { ExportSheet(store: store, onClose: drawer.closeExport) }
                    else { AgentSheet(store: store, player: player, drawer: drawer, dismissKeyboard: dismissKeyboard) }
                }
                .frame(height: drawer.height(in: geometry.size.height))
                .background(drawer.composing ? Color.revlineBackground : Color.revlineCard)
                .clipShape(.rect(topLeadingRadius: 32, topTrailingRadius: 32))
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
                    Button { dismissKeyboard += 1; drawer.showExport() } label: { Text("Export").foregroundStyle(Color.revlineForeground) }
                        .buttonStyle(.borderedProminent).tint(.revlineAccent)
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
