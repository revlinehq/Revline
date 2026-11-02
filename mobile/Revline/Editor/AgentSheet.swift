import SwiftUI

struct AgentSheet: View {
    let store: ProjectStore
    let player: PlayerController
    let drawer: AgentDrawerState
    let dismissKeyboard: Int
    var isSidebar = false
    @State private var media = false
    @State private var localKeyboardDismiss = 0

    private var collapsed: Bool { !isSidebar && drawer.compact }

    var body: some View {
        VStack(spacing: 0) {
            if !isSidebar && !drawer.composing {
                AgentDrawerHandle(drawer: drawer) { localKeyboardDismiss += 1 }
            }
            if !collapsed {
                HStack {
                    Label("Conversation", systemImage: "bubble.left").font(.subheadline)
                    Spacer()
                    if !isSidebar {
                        Button("Collapse conversation", systemImage: "xmark") {
                            localKeyboardDismiss += 1
                            drawer.collapse()
                        }
                        .labelStyle(.iconOnly).buttonStyle(.bordered).buttonBorderShape(.circle)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
                .padding(.horizontal, 20)
            }
            if !collapsed {
                if let before = store.beforeEditDuration, let after = store.timeline?.duration,
                   store.project?.revision != store.beforeEditRevision {
                    EditResultRow(store: store, before: before, after: after)
                }
                ConversationView(project: store)
                    .simultaneousGesture(TapGesture().onEnded { localKeyboardDismiss += 1 })
            }
            if !collapsed, let error = store.error ?? store.status?.unavailableReason {
                ErrorBanner(message: error) { store.error = nil; store.refreshID += 1 }.font(.subheadline).lineLimit(3).padding(.horizontal)
            }
            if let progress = store.importProgress {
                ProgressView(store.importLabel, value: progress).padding(.horizontal)
            }
            AgentComposer(store: store, player: player, onAttach: { media = true }, dismissKeyboard: dismissKeyboard + localKeyboardDismiss, showsConversationButton: !isSidebar, onConversation: toggleConversation, onFocusChange: drawer.focusChanged, onAccepted: drawer.expandConversation, onHeightChange: drawer.measureComposer)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background(!isSidebar && drawer.composing ? Color.revlineBackground : Color.revlineCard)
        .onChange(of: store.error ?? store.status?.error ?? store.status?.unavailableReason, initial: true) { _, value in
            if value != nil {
                localKeyboardDismiss += 1
                drawer.expandConversation()
            }
        }
        .sheet(isPresented: $media) {
            MediaLibraryView(store: store).presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }

    private func toggleConversation() {
        localKeyboardDismiss += 1
        drawer.toggleConversation()
    }
}
