import SwiftUI

struct LegalLinks: View {
    var body: some View {
        HStack(spacing: 20) {
            Link("Privacy", destination: URL(string: "https://tryrevline.com/privacy")!)
            Link("Terms", destination: URL(string: "https://tryrevline.com/terms")!)
        }
        .font(.footnote).frame(minHeight: 44)
    }
}
