import SwiftUI

struct WorkspaceStateView: View {
    let title: String
    var description: String?
    var symbol = "rectangle.stack"
    var loading = false
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        if loading {
            ProgressView(title)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                if let description { Text(description) }
            } actions: {
                if let actionTitle, let action {
                    Button(actionTitle, action: action).buttonStyle(.bordered)
                }
            }
        }
    }
}
