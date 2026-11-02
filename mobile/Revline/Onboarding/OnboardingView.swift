import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    @State private var page = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let pages = [
        OnboardingPage(id: 0, image: "PromptEditing", title: "Edit in your own words.",
                       description: "Bring your footage and describe the cut. Revline handles the timeline while you shape the story.", caption: "An edit made in Revline"),
        OnboardingPage(id: 1, image: "Clipping", title: "Find the moments worth keeping.",
                       description: "Turn long videos into focused clips, with captions, reframing, and a timeline for every idea.", caption: "The clipping workspace"),
        OnboardingPage(id: 2, image: "MotionDesign", title: "Give your ideas some motion.",
                       description: "Build launch films and motion scenes in conversation. Preview every change, then export when you’re ready.", caption: "A motion film made in Revline"),
    ]

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                ForEach(pages) { OnboardingPageView(page: $0).tag($0.id) }
            }
            .tabViewStyle(.page)
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .safeAreaInset(edge: .bottom) {
                Button(action: advance) {
                    ActionLabel(title: page == pages.count - 1 ? "Get started" : "Continue")
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .padding().frame(maxWidth: .infinity)
                .background(.bar)
            }
            .navigationTitle("Revline").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Skip", action: onComplete) } }
        }
    }

    private func advance() {
        if page == pages.count - 1 { onComplete() }
        else if reduceMotion { page += 1 }
        else { withAnimation { page += 1 } }
    }
}
