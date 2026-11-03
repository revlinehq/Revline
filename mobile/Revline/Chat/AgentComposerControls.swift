import SwiftUI

struct AgentComposerControls: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var store: ProjectStore
    let showsConversationButton: Bool
    let onAttach: () -> Void
    let onConversation: () -> Void

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                Picker("Editing mode", selection: $store.editMode) {
                    Text("Fast").tag("fast")
                    Text("Precise").tag("precise")
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                actions
            }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    modePicker.fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 0)
                    actions
                }
                VStack(spacing: 8) {
                    modePicker
                    actions
                }
            }
        }
    }

    private var modePicker: some View {
        Picker("Editing mode", selection: $store.editMode) {
            Text("Fast").tag("fast")
            Text("Precise").tag("precise")
        }
        .pickerStyle(.segmented)
        .frame(minHeight: 44)
    }

    private var actions: some View {
        HStack(spacing: 8) {
            if showsConversationButton {
                Button("Show conversation", systemImage: "bubble.left", action: onConversation)
                    .labelStyle(.iconOnly).buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
            }
            if !store.attachedAssetIDs.isEmpty {
                Button("\(store.attachedAssetIDs.count) attached", action: onAttach)
                    .font(.subheadline).buttonStyle(.borderless)
                    .frame(minHeight: 44)
            }
        }
    }
}
