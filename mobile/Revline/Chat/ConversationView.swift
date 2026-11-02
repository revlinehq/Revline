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
                        } label: { ActionLabel(title: "Earlier messages", busyTitle: "Loading…", busy: chat.loadingMore) }
                        .buttonStyle(.bordered)
                    }
                    if chat.loading { WorkspaceStateView(title: "Loading conversation…", loading: true) }

                    ForEach(chat.messages) { ChatMessageView(message: $0) }
                    if let queue = project.queue, !queue.messages.isEmpty {
                        QueuedMessagesView(queue: queue, project: project)
                    }
                    if project.status?.running == true {
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(project.status?.activity ?? "Working…").font(.subheadline).tint(.revlineAccent)
                            if let external = project.status?.externalAgent, external.running {
                                Text("\(external.name) is editing this project.").font(.subheadline).foregroundStyle(Color.revlineMuted)
                            }
                        }.padding(.horizontal, 16).padding(.bottom, 8)
                    }
                    if let error = project.status?.error {
                        ErrorBanner(message: error) { Task { await retryFailedTurn() } }
                            .disabled(chat.loading || !chat.messages.contains(where: { $0.role == "user" }))
                    }
                    Color.clear.frame(height: 1).id("latest")
                        .onAppear { followLatest = true }
                        .onDisappear { followLatest = false }
                }.padding(.horizontal, 16).padding(.vertical, 16)
            }
            .overlay {
                if !chat.loading && chat.messages.isEmpty && project.status?.running != true && project.queue?.messages.isEmpty != false {
                    ContentUnavailableView("Start an edit", systemImage: "bubble.left", description: Text("Describe the change you want to make."))
                }
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
            .onChange(of: chat.messages.last?.text) { _, _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: project.status?.running) { _, _ in if followLatest { reader.scrollTo("latest", anchor: .bottom) } }
        }
        .task(id: "\(project.project?.threadId ?? "")-\(project.refreshID)") {
            await chat.observe(session, projectID: project.id, threadID: project.project?.threadId)
        }
        .task(id: chat.streamSignature) { await chat.observeDeltas(session, projectID: project.id, threadID: project.project?.threadId) }
    }

    private func retryFailedTurn() async {
        guard let message = chat.messages.last(where: { $0.role == "user" }) else { return }
        project.error = nil
        await project.mutate(session, "assistant:retry", arguments: ["projectId": project.id, "promptMessageId": message.id])
    }
}
