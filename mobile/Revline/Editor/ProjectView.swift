import SwiftUI

struct ProjectView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var store: ProjectStore
    @State private var player = PlayerController()
    @State private var media = false
    @State private var exports = false

    init(projectID: String) { _store = State(initialValue: ProjectStore(id: projectID)) }

    var body: some View {
        @Bindable var player = player
        VStack(spacing: 0) {
            if store.project != nil {
                preview
                HStack(spacing: 12) {
                    Button(player.playing ? "Pause" : "Play", systemImage: player.playing ? "pause.fill" : "play.fill") { player.playPause() }
                        .labelStyle(.iconOnly).frame(width: 44, height: 44)
                        .disabled(store.timeline?.clips.isEmpty != false || !player.ready)
                    Text(timecode(player.time)).font(.caption.monospacedDigit()).frame(width: 38)
                    Slider(value: $player.time, in: 0...max(0.01, store.timeline?.duration ?? 0)) { editing in
                        player.scrubbing = editing
                        if editing { player.pause() } else { player.seek(player.time) }
                    }.accessibilityLabel("Preview position")
                    Text(timecode(store.timeline?.duration ?? 0)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }.padding(.horizontal, 12)
                TimelineStrip(timeline: store.timeline, player: player).padding(.bottom, 8)
                Divider().overlay(.white.opacity(0.04))
                if let error = store.error ?? store.status?.error ?? store.status?.reason {
                    ErrorBanner(message: error) { store.error = nil; store.refreshID += 1 }.padding(12)
                }
                ConversationView(project: store)
                if let progress = store.importProgress {
                    ProgressView(value: progress) { Text(store.importLabel).font(.caption) }
                        .padding(.horizontal, 20).padding(.bottom, 8)
                }
                AgentComposer(store: store, player: player) { media = true }
            } else if let error = store.error {
                ContentUnavailableView {
                    Label("Couldn’t open project", systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Retry") { store.refreshID += 1 }
                }
            } else { Spacer(); ProgressView("Opening project…"); Spacer() }
        }
        .frame(maxWidth: 1000).frame(maxWidth: .infinity)
        .background(RevlineTheme.background)
        .navigationTitle(store.project?.title ?? "Project").navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Project actions", systemImage: "ellipsis") {
                    Button("Media", systemImage: "photo.on.rectangle") { media = true }
                    Button("Exports", systemImage: "square.and.arrow.up") { exports = true }
                    if store.tabs.count > 1 {
                        ForEach(store.tabs) { tab in
                            Button { store.selectedTab = tab.id } label: {
                                Label(tab.name, systemImage: tab.id == store.timelineID ? "checkmark" : "rectangle")
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $media) { MediaLibraryView(store: store) }
        .sheet(isPresented: $exports) { ExportsView(store: store) }
        .task(id: store.refreshID) { store.observe(session) }
        .onChange(of: store.timelineID) { _, id in player.selectTimeline(id) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { player.pause() }
            else { Task { await player.authenticate(session) } }
        }
        .onDisappear { player.pause(); store.disconnect() }
    }

    private var preview: some View {
        ZStack {
            Color.black
            if store.timeline?.clips.isEmpty == false {
                WebPlayer(projectID: store.id, session: session, controller: player).id(player.reloadID)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "play.rectangle").font(.largeTitle.weight(.ultraLight))
                    Text("Your preview starts here").font(.footnote)
                }.foregroundStyle(.tertiary)
            }
            if let error = player.error {
                VStack(spacing: 12) {
                    Text(error).font(.footnote).multilineTextAlignment(.center)
                    Button("Reload preview") { player.retry() }.buttonStyle(.bordered)
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(.black.opacity(0.9))
            }
        }
        .frame(height: 216)
        .accessibilityLabel("Timeline preview")
    }
}
