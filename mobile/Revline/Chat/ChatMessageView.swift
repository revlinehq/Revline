import SwiftUI

struct ChatMessageView: View {
    let message: ChatMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message.role == "user" ? "You" : "Revline")
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if !message.tools.isEmpty {
                DisclosureGroup("\(message.tools.count) \(message.tools.count == 1 ? "step" : "steps")") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(message.tools.enumerated()), id: \.offset) { _, tool in
                            ToolActivityRow(tool: tool)
                        }
                    }.padding(.top, 8)
                }.font(.footnote).tint(.secondary)
            }
            if !message.text.isEmpty {
                Text(LocalizedStringKey(message.text))
                    .font(.subheadline).lineSpacing(4).textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(message.role == "user" ? RevlineTheme.raised : .clear, in: .rect(cornerRadius: 16))
    }
}

private struct ToolActivityRow: View {
    let tool: JSONValue
    private var failed: Bool {
        tool["state"]?.string == "output-error" || tool["state"]?.string == "output-denied" || tool["errorText"]?.string != nil || outputFailure
    }
    private var outputFailure: Bool {
        guard let value = tool["output"]?["error"] else { return false }
        switch value {
        case .null, .bool(false): return false
        case .string(let text): return !text.isEmpty
        default: return true
        }
    }
    private var done: Bool { tool["state"]?.string == "output-available" }
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: failed ? "exclamationmark.circle" : done ? "checkmark.circle" : "circle.dotted")
                .foregroundStyle(failed ? .red : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text((tool["type"]?.string?.replacingOccurrences(of: "tool-", with: "") ?? "Step")
                    .replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).capitalized)
                    .font(.caption).lineLimit(2)
                if let detail = tool["errorText"]?.string { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            Text(failed ? "Failed" : done ? "Done" : "Working").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
