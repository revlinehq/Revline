import SwiftUI

struct AgentDrawerHandle: View {
    let drawer: AgentDrawerState
    let dismissKeyboard: () -> Void

    var body: some View {
        Button(drawer.compact ? "Expand conversation" : "Collapse conversation", systemImage: "minus") {
            dismissKeyboard()
            drawer.toggleConversation()
        }
        .labelStyle(.iconOnly).font(.title).foregroundStyle(Color.revlineMuted)
        .buttonStyle(.plain).frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(.rect)
        .simultaneousGesture(DragGesture().onEnded { value in
            dismissKeyboard()
            drawer.dragEnded(value.translation.height)
        })
        .accessibilityHint("Drag up to expand the conversation or down to collapse it.")
    }
}
