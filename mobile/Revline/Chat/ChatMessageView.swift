import SwiftUI

struct ChatMessageView: View {
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message.role == "user" ? "You" : "Revline")
                .font(.headline).foregroundStyle(.secondary)
            if !message.tools.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(message.tools.enumerated()), id: \.offset) { _, tool in
                            ToolActivityRow(tool: tool)
                        }
                    }.padding(.top, 8)
                } label: {
                    Text("\(message.tools.count) \(message.tools.count == 1 ? "step" : "steps")").frame(minHeight: 44)
                }.font(.subheadline).tint(.secondary)
            }
            if !message.text.isEmpty {
                Text(LocalizedStringKey(message.text))
                    .font(.subheadline).lineSpacing(4).textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(message.role == "user" ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 12))
    }
}
