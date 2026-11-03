import SwiftUI

struct ProjectWorkspacePreview: View {
    let store: ProjectStore
    let player: PlayerController
    let showsTransport: Bool
    let onDismissKeyboard: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if store.project != nil {
                ProjectPreview(store: store, player: player)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(.rect)
                    .simultaneousGesture(TapGesture().onEnded { onDismissKeyboard() })
                if showsTransport { PreviewTransport(store: store, player: player) }
            } else if let error = store.error {
                WorkspaceStateView(title: "Couldn’t open project", description: error, symbol: "wifi.slash", actionTitle: "Try again") { store.refreshID += 1 }
            } else { WorkspaceStateView(title: "Opening project…", loading: true) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
