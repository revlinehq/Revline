import SwiftUI

struct ToolActivityRow: View {
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
    private var name: String {
        let value = (tool["type"]?.string?.replacingOccurrences(of: "tool-", with: "") ?? "Step")
            .replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).lowercased()
        return value.prefix(1).uppercased() + value.dropFirst()
    }
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: failed ? "exclamationmark.circle" : done ? "checkmark.circle" : "circle.dotted")
                .foregroundStyle(failed ? Color.red : Color.revlineMuted)
            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.subheadline).lineLimit(2)
                if let detail = tool["errorText"]?.string { Text(detail).font(.subheadline).foregroundStyle(Color.revlineMuted) }
            }
            Spacer(minLength: 0)
            Text(failed ? "Failed" : done ? "Done" : "Working").font(.subheadline).foregroundStyle(Color.revlineMuted)
        }
    }
}
