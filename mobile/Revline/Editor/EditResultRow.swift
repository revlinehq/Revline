import SwiftUI

struct EditResultRow: View {
    @Environment(AppSession.self) private var session
    let store: ProjectStore
    let before: Double
    let after: Double
    @State private var undoing = false

    var body: some View {
        HStack(spacing: 8) {
            Text(timecode(before)).foregroundStyle(Color.secondary)
            Image(systemName: "arrow.right").accessibilityHidden(true)
            Text(timecode(after)).bold()
            Spacer()
            Button("Undo") { Task { await undo() } }
                .buttonStyle(.borderless).frame(minHeight: 44)
                .disabled(store.status?.running == true || undoing)
        }
        .font(.subheadline.monospacedDigit()).padding(.horizontal, 20)
    }

    private func undo() async {
        undoing = true
        defer { undoing = false }
        do {
            let _: Double = try await session.client.mutation("projects:undo", with: ["projectId": store.id])
            store.beforeEditDuration = nil
        } catch { store.error = AppFailure.describe(error) }
    }
}
