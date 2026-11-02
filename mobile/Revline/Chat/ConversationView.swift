import SwiftUI

struct ConversationView: View {
    @Environment(AppSession.self) private var session
    let project: ProjectStore
    @State private var chat = ChatStore()
    @State private var followLatest = true

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if let error = chat.error { ErrorBanner(message: error) { project.refreshID += 1 } }
                    if chat.canLoadMore {
                        Button {
                            followLatest = false
                            Task { await chat.loadMore(session, projectID: project.id, threadID: project.project?.threadId) }
                        } label: { if chat.loadingMore { ProgressView() } else { Text("Earlier messages").font(.footnote) } }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    if chat.loading { ProgressView().frame(maxWidth: .infinity).padding() }
                    else if chat.messages.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("What are we making?").font(.title3.weight(.medium))
                            Text("Ask for a tighter cut, turn a long video into clips, or build a motion film.")
                                .font(.subheadline).foregroundStyle(.secondary).lineSpacing(4)
                        }.padding(16)
                    }
                    ForEach(chat.messages) { ChatMessageView(message: $0) }
                    if let queue = project.queue, !queue.messages.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(queue.paused ? "Queue paused" : "Up next").font(.caption).foregroundStyle(.secondary)
                            ForEach(queue.messages) { item in
                                HStack(alignment: .top) {
                                    Text(item.prompt).font(.footnote).lineLimit(3)
                                    Spacer()
                                    Button("Remove queued message", systemImage: "xmark") {
                                        Task { await project.mutate(session, "assistant:removeQueued", arguments: ["projectId": project.id, "id": item.id]) }
                                    }.labelStyle(.iconOnly)
                                }
                            }
                            if queue.paused {
                                Button("Resume queue") { Task { await project.mutate(session, "assistant:resumeQueue", arguments: ["projectId": project.id]) } }
                                    .font(.footnote)
                            }
                        }.padding(16).background(RevlineTheme.surface, in: .rect(cornerRadius: 12))
                    }
                    if project.status?.running == true {
                        VStack(alignment: .leading, spacing: 8) {
                            WorkingLabel()
                            if let activity = project.status?.activity { Text(activity).font(.caption).foregroundStyle(.secondary) }
                            if let external = project.status?.externalAgent, external.running {
                                Text("\(external.name) is editing this project.").font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.horizontal, 16).padding(.bottom, 8)
                    }
                    Color.clear.frame(height: 1).id("latest")
                        .onAppear { followLatest = true }
                        .onDisappear { followLatest = false }
                }.padding(12)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: chat.messages.last?.text) { _, _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: project.status?.running) { _, _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
        }
        .task(id: "\(project.project?.threadId ?? "")-\(project.refreshID)") {
            await chat.observe(session, projectID: project.id, threadID: project.project?.threadId)
        }
        .task(id: chat.streamSignature) { await chat.observeDeltas(session, projectID: project.id, threadID: project.project?.threadId) }
    }
}
