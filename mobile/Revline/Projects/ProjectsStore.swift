@preconcurrency import ConvexMobile
import Observation

@MainActor @Observable
final class ProjectsStore {
    var projects: [ProjectSummary] = []
    var loading = true
    var error: String?
    var refreshID = 0
    var busy = false

    func observe(_ session: AppSession) async {
        loading = projects.isEmpty
        error = nil
        await observeConvex(session.client, "projects:list", arguments: ["limit": 100.0],
                            as: [ProjectSummary].self) { [self] value in
            projects = value
            loading = false
            error = nil
        } onError: { [self] message in error = message; loading = false }
    }

    func create(_ session: AppSession, title: String, aspectRatio: String) async throws -> String {
        busy = true
        defer { busy = false }
        return try await session.client.mutation("projects:create", with: ["title": title, "aspectRatio": aspectRatio])
    }

    func rename(_ session: AppSession, project: ProjectSummary, title: String) async {
        do { try await session.client.mutation("projects:update", with: ["projectId": project.id, "title": title]) }
        catch { self.error = AppFailure.describe(error) }
    }

    func remove(_ session: AppSession, project: ProjectSummary) async {
        do { try await session.client.mutation("projects:remove", with: ["projectId": project.id]) }
        catch { self.error = AppFailure.describe(error) }
    }
}
