import SwiftUI

struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(page.image).resizable().scaledToFit()
                    .clipShape(.rect(cornerRadius: 12))
                    .accessibilityLabel(page.caption)
                Text(page.title).font(.largeTitle).bold()
                Text(page.description).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding().frame(maxWidth: 560).frame(maxWidth: .infinity)
        }
    }
}
