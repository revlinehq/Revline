import Combine
@preconcurrency import ConvexMobile
import Foundation
import Observation

@MainActor @Observable
final class ChatStore {
    private var stored: [String: ChatMessage] = [:]
    private var live: [String: StreamingMessage] = [:]
    private var cursors: [String: Double] = [:]
    var streams: [MessageStream] = []
    var loading = true
    var error: String?
    var loadingMore = false
    var canLoadMore = false
    private var nextCursor: String?
    private var expandedHistory = false

    var streamSignature: String { streams.map(\.streamId).sorted().joined(separator: ",") }

    var messages: [ChatMessage] {
        var snapshots = Array(stored.values).filter { $0.role != "system" }
        for stream in streams {
            guard let materialized = live[stream.streamId], !materialized.parts.isEmpty else { continue }
            snapshots.append(ChatMessage(id: "stream-" + stream.streamId, role: "assistant", order: stream.order,
                                         stepOrder: stream.stepOrder, status: "streaming", parts: materialized.parts))
        }
        snapshots.sort { $0.order == $1.order ? $0.stepOrder < $1.stepOrder : $0.order < $1.order }
        var deduplicated: [ChatMessage] = []
        for message in snapshots {
            if let last = deduplicated.last, last.order == message.order, last.stepOrder == message.stepOrder {
                if ["pending", "streaming"].contains(last.status ?? ""), message.status != "pending" {
                    deduplicated[deduplicated.count - 1] = message
                }
            } else { deduplicated.append(message) }
        }
        var combined: [ChatMessage] = []
        for message in deduplicated {
            guard let previous = combined.last, previous.role == "assistant", message.role == "assistant", previous.order == message.order else {
                combined.append(message)
                continue
            }
            var parts = previous.parts
            for part in message.parts {
                if let callID = part["toolCallId"]?.string,
                   let index = parts.firstIndex(where: { $0["toolCallId"]?.string == callID }),
                   case .object(var fields) = parts[index], case .object(let updates) = part {
                    fields.merge(updates) { _, new in new }
                    parts[index] = .object(fields)
                } else { parts.append(part) }
            }
            combined[combined.count - 1] = ChatMessage(id: previous.id, role: previous.role, order: previous.order,
                                                       stepOrder: previous.stepOrder, status: message.status, parts: parts)
        }
        return combined
    }

    func observe(_ session: AppSession, projectID: String, threadID: String?) async {
        stored = [:]; live = [:]; cursors = [:]; streams = []; nextCursor = nil; expandedHistory = false
        error = nil
        guard let threadID else { loading = false; return }
        loading = true
        await observeConvex(session.client, "assistant:messages", arguments: arguments(projectID, threadID, count: 40),
            as: MessagePage.self) { [self] page in
            for message in page.page { stored[message.id] = message }
            streams = page.streams.messages ?? []
            if !expandedHistory { nextCursor = page.continueCursor; canLoadMore = !page.isDone }
            let active = Set(streams.map(\.streamId))
            live = live.filter { active.contains($0.key) }
            cursors = cursors.filter { active.contains($0.key) }
            loading = false
        } onError: { [self] message in error = message; loading = false }
    }

    func observeDeltas(_ session: AppSession, projectID: String, threadID: String?) async {
        guard let threadID, !streams.isEmpty else { return }
        let streamCursors = streams.map { JSONValue.object(["streamId": .string($0.streamId), "cursor": .number(cursors[$0.streamId] ?? 0)]) }
        var args = arguments(projectID, threadID, count: 0)
        args["streamArgs"] = JSONValue.object(["kind": .string("deltas"), "cursors": .array(streamCursors)])
        await observeConvex(session.client, "assistant:messages", arguments: args, as: MessagePage.self) { [self] page in
            for delta in (page.streams.deltas ?? []).sorted(by: { $0.start < $1.start }) {
                let cursor = cursors[delta.streamId] ?? 0
                guard delta.end > cursor else { continue }
                guard delta.start == cursor else { error = "The response stream was interrupted. Reopen the project to reconnect."; continue }
                for chunk in delta.parts { live[delta.streamId, default: StreamingMessage()].apply(chunk) }
                cursors[delta.streamId] = delta.end
            }
        } onError: { [self] in error = $0 }
    }

    func loadMore(_ session: AppSession, projectID: String, threadID: String?) async {
        guard let threadID, let nextCursor, canLoadMore, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            for try await page in session.client.subscribe(to: "assistant:messages",
                with: arguments(projectID, threadID, count: 40, cursor: nextCursor), yielding: MessagePage.self).values {
                for message in page.page { stored[message.id] = message }
                self.nextCursor = page.continueCursor
                expandedHistory = true
                canLoadMore = !page.isDone
                break
            }
        } catch { self.error = AppFailure.describe(error) }
    }

    private func arguments(_ projectID: String, _ threadID: String, count: Double, cursor: String? = nil) -> ConvexArguments {
        ["projectId": projectID, "threadId": threadID,
         "paginationOpts": JSONValue.object(["numItems": .number(count), "cursor": cursor.map(JSONValue.string) ?? .null]),
         "streamArgs": JSONValue.object(["kind": .string("list")])]
    }
}
