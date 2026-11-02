import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    @State private var page = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let pages: [OnboardingPage] = [
        OnboardingPage(id: 0, image: "PromptEditing", title: "Edit in your\nown words.",
                       description: "Bring your footage and describe the cut. Revline handles the timeline while you shape the story.", caption: "An edit made in Revline"),
        OnboardingPage(id: 1, image: "Clipping", title: "Find the moments\nworth keeping.",
                       description: "Turn long videos into focused clips, with captions, reframing, and a timeline for every idea.", caption: "The clipping workspace"),
        OnboardingPage(id: 2, image: "MotionDesign", title: "Give your ideas\nsome motion.",
                       description: "Build launch films and motion scenes in conversation. Preview every change, then export when you’re ready.", caption: "A motion film made in Revline"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("revline", systemImage: "play.rectangle.fill").font(.title3.weight(.semibold))
                Spacer()
                Button("Skip", action: onComplete).font(.subheadline).foregroundStyle(.secondary)
            }.padding(.horizontal, 24).padding(.top, 20)
            TabView(selection: $page) {
                ForEach(pages) { item in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            Spacer(minLength: 28)
                            Image(item.image).resizable().scaledToFit()
                                .clipShape(.rect(cornerRadius: 16))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(.white.opacity(0.08)))
                                .accessibilityLabel(item.caption)
                            Text(item.caption).font(.caption).foregroundStyle(.tertiary)
                            Text(item.title).font(.largeTitle.weight(.semibold)).tracking(-0.8)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(item.description).font(.body).foregroundStyle(.secondary).lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                        }.padding(24).frame(maxWidth: 600).frame(maxWidth: .infinity)
                    }.tag(item.id)
                }
            }.tabViewStyle(.page(indexDisplayMode: .never))
            HStack(spacing: 8) {
                ForEach(0..<3) { index in
                    Capsule().fill(index == page ? .white : .white.opacity(0.2)).frame(width: index == page ? 24 : 8, height: 4)
                }
                Spacer()
                Text("\(page + 1) of 3").font(.caption).foregroundStyle(.tertiary)
            }.accessibilityElement(children: .ignore).accessibilityLabel("Page \(page + 1) of 3")
                .padding(.horizontal, 28).padding(.bottom, 24)
            Button {
                if page == 2 { onComplete() }
                else if reduceMotion { page += 1 }
                else { withAnimation(.easeInOut(duration: 0.25)) { page += 1 } }
            } label: {
                HStack { Text(page == 2 ? "Get started" : "Continue").fontWeight(.semibold); Spacer(); Image(systemName: "arrow.right") }
                    .foregroundStyle(.black).padding(18).background(.white, in: .rect(cornerRadius: 16))
            }.padding(.horizontal, 24).padding(.bottom, 24)
        }
        .background(RevlineTheme.background)
    }
}

private struct OnboardingPage: Identifiable {
    let id: Int
    let image: String
    let title: String
    let description: String
    let caption: String
}
