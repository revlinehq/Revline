import SwiftUI

struct ProjectPreview: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let player: PlayerController

    var body: some View {
        ZStack {
            Color.revlineBackground
            if store.timeline?.clips.isEmpty == false {
                WebPlayer(projectID: store.id, session: session, controller: player).id(player.reloadID)
                if !player.ready && player.error == nil {
                    ProgressView("Loading preview…").tint(.revlineForeground).foregroundStyle(Color.revlineForeground)
                        .allowsHitTesting(false)
                }
            } else {
                Label("Your preview starts here", systemImage: "play.rectangle").foregroundStyle(Color.revlineForeground)
            }
            if let error = player.error {
                VStack {
                    Text(error).multilineTextAlignment(.center)
                    Button("Reload preview", action: player.retry).buttonStyle(.bordered)
                }
                .foregroundStyle(Color.revlineForeground).tint(.revlineForeground).padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.revlineBackground)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Timeline preview")
    }
}
