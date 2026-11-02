import Combine
@preconcurrency import ConvexMobile
import Foundation
import Observation

@MainActor @Observable
final class ProjectStore {
    let id: String
    var project: ProjectDocument?
    var status: AssistantStatus?
    var assets: [MediaAsset] = []
    var exports: [ExportJob] = []
    var mediaTasks: [MediaTaskState] = []
    var tabs: [TimelineTab] = []
    var snapshots: [TimelineSnapshot] = []
    var queue: AssistantQueue?
    var selectedTab: String?
    var attachedAssetIDs: [String] = []
    var error: String?
    var refreshID = 0
    var sending = false
    var importProgress: Double?
    var importLabel = ""
    var uploadTask: Task<Void, Never>?

    init(id: String) { self.id = id }

    var timelineID: String { selectedTab ?? project?.activeTimelineId ?? "main" }
    var timeline: TimelineDocument? {
        if timelineID == (project?.activeTimelineId ?? "main") { return project?.timeline }
        return snapshots.first { $0.id == timelineID }?.timeline
    }

    private var subscriptions: Set<AnyCancellable> = []

    func observe(_ session: AppSession) {
        subscriptions.removeAll()
        error = nil
        watch(session, "projects:get", ["projectId": id, "includeHistory": false, "sceneCode": "refs"], ProjectDocument.self) { store, value in
            store.project = value
            if store.selectedTab == nil { store.selectedTab = value.activeTimelineId ?? "main" }
        }
        watch(session, "assistant:status", ["projectId": id], AssistantStatus.self) { $0.status = $1 }
        watch(session, "assets:list", ["projectId": id, "limit": 200.0], [MediaAsset].self) { $0.assets = $1 }
        watch(session, "renders:list", ["projectId": id, "limit": 40.0], [ExportJob].self) { $0.exports = $1 }
        watch(session, "mediaTasks:list", ["projectId": id], [MediaTaskState].self) { $0.mediaTasks = $1 }
        watch(session, "timelineTabs:list", ["projectId": id], [TimelineTab].self) { store, value in
            store.tabs = value
            if let selectedTab = store.selectedTab, !value.contains(where: { $0.id == selectedTab }) { store.selectedTab = nil }
        }
        watch(session, "timelineTabs:snapshots", ["projectId": id], [TimelineSnapshot].self) { $0.snapshots = $1 }
        watch(session, "assistant:queued", ["projectId": id], AssistantQueue.self) { $0.queue = $1 }
    }

    func disconnect() { subscriptions.removeAll() }

    private func watch<Value: Decodable & Sendable>(_ session: AppSession, _ name: String, _ args: ConvexArguments,
                                                    _ type: Value.Type, receive: @escaping @MainActor (ProjectStore, Value) -> Void) {
        session.client.subscribe(to: name, with: args, yielding: type)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                if case .failure(let failure) = completion {
                    MainActor.assumeIsolated { self?.error = AppFailure.describe(failure) }
                }
            } receiveValue: { [weak self] value in
                MainActor.assumeIsolated { if let self { receive(self, value) } }
            }
            .store(in: &subscriptions)
    }

    func send(_ session: AppSession, prompt: String, mode: String, model: String?, playhead: Double) async -> Bool {
        sending = true
        defer { sending = false }
        var arguments: ConvexArguments = ["projectId": id, "prompt": prompt, "editMode": mode,
                                          "timelineId": timelineID, "playhead": playhead]
        if status?.modelSwitcher == true, let model { arguments["modelChoice"] = model }
        if !attachedAssetIDs.isEmpty { arguments["attachedAssetIds"] = JSONValue.array(attachedAssetIDs.map(JSONValue.string)) }
        do {
            try await session.client.mutation("assistant:send", with: arguments)
            attachedAssetIDs = []
            return true
        } catch { self.error = AppFailure.describe(error); return false }
    }

    func stop(_ session: AppSession) async {
        await mutate(session, "assistant:stop", arguments: ["projectId": id])
    }

    func mutate(_ session: AppSession, _ name: String, arguments: ConvexArguments) async {
        do { try await session.client.mutation(name, with: arguments) }
        catch { self.error = AppFailure.describe(error) }
    }
}
