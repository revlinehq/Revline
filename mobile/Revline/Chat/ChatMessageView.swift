import SwiftUI

struct ChatMessageView: View {
    let message: ChatMessage

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 48)
                Text(message.text).font(.body).textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Color.revlinePopover, in: .rect(cornerRadius: 18))
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                if !message.tools.isEmpty {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(message.tools.enumerated()), id: \.offset) { _, tool in ToolActivityRow(tool: tool) }
                        }.padding(.top, 8)
                    } label: {
                        Text("\(message.tools.count) steps").frame(minHeight: 44)
                    }.font(.subheadline).tint(.revlineMuted)
                }
                if !message.text.isEmpty {
                    Text(LocalizedStringKey(message.text)).font(.body).lineSpacing(4).textSelection(.enabled)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
