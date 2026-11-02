import SwiftUI

struct ProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var store: ProjectStore
    @State private var player = PlayerController()
    @State private var media = false
    @State private var exports = false
    @State private var composing = false

    init(projectID: String) { _store = State(initialValue: ProjectStore(id: projectID)) }

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 0) {
            if store.project != nil {
                ProjectPreview(store: store, player: player)
                    .frame(height: composing ? 80 : verticalSizeClass == .compact ? 120 : 216)
                if !composing {
                    PreviewTransport(store: store, player: player)
                    TimelineStrip(timeline: store.timeline, player: player)
                }
                Divider()
                if let error = store.error ?? store.status?.error ?? store.status?.reason {
                    ErrorBanner(message: error) { store.error = nil; store.refreshID += 1 }.padding()
                }
                ConversationView(project: store)
                if let progress = store.importProgress {
                    ProgressView(store.importLabel, value: progress).padding(.horizontal)
                }
                AgentComposer(store: store, player: player, onAttach: { media = true }, onFocusChange: { composing = $0 })
            } else if let error = store.error {
                WorkspaceStateView(title: "Couldn’t open project", description: error, symbol: "wifi.slash", actionTitle: "Try again") { store.refreshID += 1 }
            } else {
                WorkspaceStateView(title: "Opening project…", loading: true)
            }
        }
        .frame(maxWidth: .infinity)
        .navigationTitle(store.project?.title ?? "Project").navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Project actions", systemImage: "ellipsis") {
                    Button("Media", systemImage: "photo.on.rectangle") { media = true }
                    Button("Exports", systemImage: "square.and.arrow.up") { exports = true }
                    if store.tabs.count > 1 {
                        Picker("Timeline", selection: $store.selectedTab) {
                            ForEach(store.tabs) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $media) { MediaLibraryView(store: store).presentationDetents([.large]).presentationDragIndicator(.visible) }
        .sheet(isPresented: $exports) { ExportsView(store: store).presentationDetents([.large]).presentationDragIndicator(.visible) }
        .task(id: store.refreshID) { store.observe(session) }
        .onChange(of: store.timelineID) { _, id in player.selectTimeline(id) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player.pause() }
            else { Task { await player.authenticate(session) } }
        }
        .onDisappear { player.pause(); store.disconnect() }
    }
}
