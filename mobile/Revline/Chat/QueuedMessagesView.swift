import SwiftUI

struct QueuedMessagesView: View {
    @Environment(AppSession.self) private var session
    let queue: AssistantQueue
    let project: ProjectStore

    var body: some View {
        GroupBox(queue.paused ? "Queue paused" : "Up next") {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(queue.messages) { item in
                    HStack(alignment: .top) {
                        Text(item.prompt).font(.subheadline).lineLimit(3)
                        Spacer()
                        Button("Remove queued message", systemImage: "xmark") {
                            remove(item)
                        }
                        .labelStyle(.iconOnly).buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
                if queue.paused {
                    Button("Resume queue", action: resume).buttonStyle(.bordered)
                }
            }
        }
    }

    private func remove(_ item: QueuedPrompt) {
        Task { await project.mutate(session, "assistant:removeQueued", arguments: ["projectId": project.id, "id": item.id]) }
    }

    private func resume() {
        Task { await project.mutate(session, "assistant:resumeQueue", arguments: ["projectId": project.id]) }
    }
}
