import Foundation

/// Materializes the Agent SDK's UIMessageChunk and TextStreamPart wire formats.
struct StreamingMessage: Sendable {
    var parts: [JSONValue] = []
    private var textPositions: [String: Int] = [:]
    private var toolPositions: [String: Int] = [:]
    private var toolInputs: [String: String] = [:]

    mutating func apply(_ chunk: JSONValue) {
        guard let type = chunk["type"]?.string else { return }
        let chunkID = chunk["id"]?.string ?? "text"
        switch type {
        case "text-start", "reasoning-start":
            appendText(id: chunkID, type: type == "text-start" ? "text" : "reasoning", delta: "")
        case "text-delta", "reasoning-delta":
            appendText(id: chunkID, type: type == "text-delta" ? "text" : "reasoning",
                       delta: chunk["delta"]?.string ?? chunk["text"]?.string ?? chunk["textDelta"]?.string ?? "")
        case "tool-input-start", "tool-input-delta", "tool-input-available", "tool-call", "tool-output-available", "tool-result", "tool-output-error", "tool-error":
            let id = chunk["toolCallId"]?.string ?? chunkID
            let position = toolPositions[id] ?? parts.count
            var fields: [String: JSONValue] = [:]
            if position < parts.count, case .object(let existing) = parts[position] { fields = existing }
            fields["toolCallId"] = .string(id)
            if let name = chunk["toolName"]?.string { fields["type"] = .string("tool-" + name) }
            if fields["type"] == nil { fields["type"] = .string("tool-step") }
            if type == "tool-input-delta" {
                toolInputs[id, default: ""] += chunk["inputTextDelta"]?.string ?? chunk["delta"]?.string ?? ""
                if let input = toolInputs[id]?.data(using: .utf8), let value = try? JSONDecoder().decode(JSONValue.self, from: input) {
                    fields["input"] = value
                }
            }
            if let input = chunk["input"] { fields["input"] = input }
            if type == "tool-output-available" || type == "tool-result" {
                fields["state"] = .string("output-available")
                fields["output"] = chunk["output"] ?? chunk["result"] ?? .null
            } else if type == "tool-output-error" || type == "tool-error" {
                fields["state"] = .string("output-error")
                fields["errorText"] = chunk["errorText"] ?? chunk["error"] ?? .string("This step could not finish.")
            } else { fields["state"] = .string("input-streaming") }
            if position == parts.count { parts.append(.object(fields)) } else { parts[position] = .object(fields) }
            toolPositions[id] = position
        case "error":
            appendText(id: "error", type: "text", delta: chunk["errorText"]?.string ?? "The response was interrupted.")
        default:
            if type.hasPrefix("data-") { parts.append(chunk) }
        }
    }

    private mutating func appendText(id: String, type: String, delta: String) {
        let key = type + id
        let position = textPositions[key] ?? parts.count
        let previous = position < parts.count ? parts[position]["text"]?.string ?? "" : ""
        let part = JSONValue.object(["type": .string(type), "text": .string(previous + delta)])
        if position == parts.count { parts.append(part) } else { parts[position] = part }
        textPositions[key] = position
    }
}
