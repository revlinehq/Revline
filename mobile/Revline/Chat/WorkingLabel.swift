import SwiftUI

struct WorkingLabel: View {
    var label = "Working"

    var body: some View {
        ProgressView(label).font(.subheadline).foregroundStyle(Color.secondary)
    }
}
