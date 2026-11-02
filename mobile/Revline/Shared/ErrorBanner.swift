import SwiftUI

struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.secondary)
            Text(message).font(.footnote).textSelection(.enabled)
            Spacer(minLength: 0)
            if let retry { Button("Retry", action: retry).font(.footnote.weight(.semibold)) }
        }
        .padding(14).background(RevlineTheme.raised, in: .rect(cornerRadius: 12))
        .accessibilityElement(children: .contain)
    }
}
