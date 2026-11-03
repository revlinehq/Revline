import SwiftUI

struct AgentComposer: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let player: PlayerController
    let onAttach: () -> Void
    var dismissKeyboard = 0
    var showsConversationButton = true
    var onConversation: () -> Void = { }
    var onFocusChange: (Bool) -> Void = { _ in }
    var onAccepted: () -> Void = { }
    var onHeightChange: (CGFloat) -> Void = { _ in }
    @FocusState private var focused: Bool
    @State private var sent = 0
    @State private var consent = false

    private var canSend: Bool {
        !store.promptDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.sending && (store.status?.mobileConfigured ?? store.status?.configured) == true
    }

    var body: some View {
        @Bindable var store = store
        VStack(spacing: 10) {
            AgentComposerControls(
                store: store,
                showsConversationButton: showsConversationButton,
                onAttach: onAttach,
                onConversation: onConversation
            )
            HStack(alignment: .bottom, spacing: 4) {
                Menu("Attachments and commands", systemImage: "paperclip") {
                    Button("Import media", systemImage: "photo.on.rectangle", action: onAttach)
                    Button("Clip footage", systemImage: "scissors") { store.promptDraft = "/clip "; focused = true }
                    Button("Recreate motion", systemImage: "play.rectangle") { store.promptDraft = "/inspo-motion "; focused = true }
                }
                .labelStyle(.iconOnly).buttonStyle(.borderless)
                .frame(width: 44, height: 44)
                TextField("What should change?", text: $store.promptDraft, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...5).focused($focused)
                    .font(.body).padding(.vertical, 12)
                    .accessibilityLabel("Describe your next edit")
                    .submitLabel(.send)
                    .onSubmit { if canSend { Task { await send() } } }
                if store.status?.running == true && store.promptDraft.isEmpty {
                    Button("Stop editing", systemImage: "stop.fill") { Task { await store.stop(session) } }
                        .labelStyle(.iconOnly).buttonStyle(.bordered).buttonBorderShape(.circle)
                        .frame(width: 44, height: 44)
                } else {
                    Button { Task { await send() } } label: {
                        if store.sending { ProgressView().frame(width: 20, height: 20) }
                        else { Label("Send edit", systemImage: "arrow.up").labelStyle(.iconOnly).frame(width: 20, height: 20) }
                    }
                    .buttonStyle(.borderedProminent).buttonBorderShape(.circle)
                    .tint(.accentColor).controlSize(.regular)
                    .frame(width: 44, height: 44)
                    .disabled(!canSend)
                    .accessibilityLabel(store.status?.running == true ? "Queue edit" : "Send edit")
                }
            }
            .padding(6)
            .background(Color.revlinePopover, in: .rect(cornerRadius: 28))
            .overlay { RoundedRectangle(cornerRadius: 28).stroke(Color.revlineBorder, lineWidth: 1) }
        }
        .padding(.horizontal, 16).padding(.bottom, 8)
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { onHeightChange($0) }
        .onChange(of: focused) { _, value in onFocusChange(value) }
        .onChange(of: dismissKeyboard) { focused = false }
        .sensoryFeedback(.success, trigger: sent)
        .sheet(isPresented: $consent) { AIConsentView { Task { await send() } } }
    }

    private func send() async {
        guard canSend else { return }
        guard session.aiConsentGranted else { consent = true; return }
        if await store.send(session, prompt: store.promptDraft, mode: store.editMode, playhead: player.time) {
            store.promptDraft = ""; sent += 1; focused = false; onAccepted()
        }
    }
}
