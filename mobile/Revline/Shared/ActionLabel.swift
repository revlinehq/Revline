import SwiftUI

struct ActionLabel: View {
    let title: String
    var busyTitle: String?
    var busy = false
    var symbol: String?

    var body: some View {
        HStack {
            if busy {
                ProgressView().controlSize(.small)
                Text(busyTitle ?? "Loading…")
            } else if let symbol {
                Label(title, systemImage: symbol)
            } else {
                Text(title)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 28)
    }
}
