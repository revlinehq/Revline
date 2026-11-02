import SwiftUI

struct AgentComposer: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let player: PlayerController
    let onAttach: () -> Void
    @State private var prompt = ""
    @State private var mode = "fast"
    @State private var model = ""
    @FocusState private var focused: Bool
    @State private var sent = 0

    private var canSend: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.sending && store.status?.configured == true
    }

    var body: some View {
        VStack(spacing: 12) {
            if !store.attachedAssetIDs.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(store.attachedAssetIDs, id: \.self) { id in
                            Button {
                                store.attachedAssetIDs.removeAll { $0 == id }
                            } label: {
                                Label(store.assets.first { $0.id == id }?.fileName ?? "Media", systemImage: "xmark.circle")
                                    .font(.caption).lineLimit(1).padding(8)
                                    .background(RevlineTheme.raised, in: .capsule)
                            }
                        }
                    }
                }.scrollIndicators(.hidden)
            }
            TextField("What would you change next?", text: $prompt, axis: .vertical)
                .font(.body).lineLimit(1...5).focused($focused)
                .accessibilityLabel("Describe your next edit")
                .disabled(store.sending)
            HStack(spacing: 12) {
                Button("Add media", systemImage: "plus", action: onAttach)
                    .labelStyle(.iconOnly).frame(width: 44, height: 44)
                Menu {
                    Button("Clip footage") { prompt = "/clip "; focused = true }
                    Button("Recreate motion") { prompt = "/inspo-motion "; focused = true }
                } label: { Image(systemName: "slash.circle").frame(width: 36, height: 44) }
                    .accessibilityLabel("Slash commands")
                Menu {
                    Picker("Editing mode", selection: $mode) {
                        Text("Fast").tag("fast")
                        Text("Precise").tag("precise")
                    }
                } label: { Text(mode == "fast" ? "Fast" : "Precise").font(.caption.weight(.medium)) }
                if store.status?.modelSwitcher == true {
                    Menu {
                        Picker("Model", selection: $model) {
                            Text("Default").tag("")
                            ForEach(store.status?.allowedModels ?? [], id: \.self) { Text(modelLabel($0)).tag($0) }
                        }
                    } label: {
                        Text(modelLabel(model.isEmpty ? store.status?.defaultModelChoice ?? "Default" : model))
                            .font(.caption).lineLimit(1)
                    }.accessibilityLabel("Choose model")
                }
                Spacer(minLength: 0)
                if store.status?.running == true && prompt.isEmpty {
                    Button("Stop", systemImage: "stop.fill") { Task { await store.stop(session) } }
                        .labelStyle(.iconOnly).frame(width: 44, height: 44)
                        .background(RevlineTheme.raised, in: .circle)
                } else {
                    Button { Task { await send() } } label: {
                        Image(systemName: "arrow.up").font(.body.weight(.semibold))
                            .frame(width: 40, height: 40)
                            .foregroundStyle(canSend ? .black : .secondary)
                            .background(canSend ? .white : RevlineTheme.raised, in: .circle)
                    }
                    .accessibilityLabel(store.status?.running == true ? "Queue message" : "Send message")
                    .disabled(!canSend)
                }
            }
        }
        .padding(16).background(RevlineTheme.surface, in: .rect(cornerRadius: 20))
        .padding(.horizontal, 12).padding(.bottom, 8)
        .sensoryFeedback(.success, trigger: sent)
    }

    private func send() async {
        guard canSend else { return }
        if await store.send(session, prompt: prompt, mode: mode, model: model.isEmpty ? nil : model, playhead: player.time) {
            prompt = ""; sent += 1; focused = false
        }
    }
}

func modelLabel(_ value: String) -> String {
    switch value {
    case "gpt-6.1-sol": "GPT-6.1 Sol"
    case "gpt-6-astra": "GPT-6 Astra"
    case "gpt-6.1-terra": "GPT-6.1 Terra"
    case "sonnet": "Sonnet 5.5"
    case "opus": "Opus 5.5"
    case "gemini-4-argon": "Gemini 4 Argon"
    default: value
    }
}
