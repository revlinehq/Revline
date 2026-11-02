import SwiftUI

struct AgentComposer: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let player: PlayerController
    let onAttach: () -> Void
    let onFocusChange: (Bool) -> Void
    @State private var prompt = ""
    @State private var mode = "fast"
    @State private var model = ""
    @FocusState private var focused: Bool
    @State private var sent = 0

    private var canSend: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.sending && store.status?.configured == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !store.attachedAssetIDs.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(store.attachedAssetIDs, id: \.self) { id in
                            Button {
                                store.attachedAssetIDs.removeAll { $0 == id }
                            } label: {
                                Label(store.assets.first { $0.id == id }?.fileName ?? "Media", systemImage: "xmark.circle")
                                    .lineLimit(1)
                            }.buttonStyle(.bordered).frame(minHeight: 44)
                        }
                    }
                }
            }
            HStack(alignment: .bottom) {
                TextField("What would you change next?", text: $prompt, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...5).focused($focused)
                    .accessibilityLabel("Describe your next edit").disabled(store.sending)
                    .frame(minHeight: 44)
                if store.status?.running == true && prompt.isEmpty {
                    Button("Stop", systemImage: "stop.fill") { Task { await store.stop(session) } }
                        .labelStyle(.iconOnly).buttonStyle(.bordered).controlSize(.large)
                        .frame(minWidth: 44, minHeight: 44)
                } else {
                    Button { Task { await send() } } label: {
                        if store.sending { ProgressView() }
                        else { Label("Send message", systemImage: "arrow.up").labelStyle(.iconOnly) }
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(store.status?.running == true ? "Queue message" : "Send message")
                    .disabled(!canSend)
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack { mediaControls; modePicker; modelPicker }.fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading) {
                    HStack { mediaControls; modePicker }
                    modelPicker
                }
            }
            .font(.subheadline)
        }
        .padding().background(.bar)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = false }
            }
        }
        .onChange(of: focused) { _, value in onFocusChange(value) }
        .sensoryFeedback(.success, trigger: sent)
    }

    private var mediaControls: some View {
        HStack {
            Button("Add media", systemImage: "plus", action: onAttach)
                .labelStyle(.iconOnly).buttonStyle(.bordered).frame(minWidth: 44, minHeight: 44)
            Menu("Slash commands", systemImage: "slash.circle") {
                Button("Clip footage") { prompt = "/clip "; focused = true }
                Button("Recreate motion") { prompt = "/inspo-motion "; focused = true }
            }
            .labelStyle(.iconOnly).buttonStyle(.bordered).frame(minWidth: 44, minHeight: 44)
        }
    }

    private var modePicker: some View {
        Picker("Editing mode", selection: $mode) {
            Text("Fast").tag("fast")
            Text("Precise").tag("precise")
        }.pickerStyle(.menu).buttonStyle(.bordered).frame(minHeight: 44)
    }

    @ViewBuilder private var modelPicker: some View {
        if store.status?.modelSwitcher == true {
            Menu {
                Picker("Model", selection: $model) {
                    Text("Default").tag("")
                    ForEach(store.status?.allowedModels ?? [], id: \.self) { Text(modelLabel($0)).tag($0) }
                }
            } label: {
                Text(modelLabel(model.isEmpty ? store.status?.defaultModelChoice ?? "Default" : model)).lineLimit(1)
            }
            .buttonStyle(.bordered).frame(minHeight: 44)
            .accessibilityLabel("Model")
            .accessibilityValue(modelLabel(model.isEmpty ? store.status?.defaultModelChoice ?? "Default" : model))
        }
    }

    private func send() async {
        guard canSend else { return }
        if await store.send(session, prompt: prompt, mode: mode, model: model.isEmpty ? nil : model, playhead: player.time) {
            prompt = ""; sent += 1; focused = false
        }
    }
}
