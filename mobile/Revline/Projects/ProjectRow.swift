import SwiftUI

struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        HStack(spacing: 12) {
            MediaThumbnail(url: project.coverUrl, kind: project.coverKind)
                .frame(width: 80, height: 60)
                .clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(project.title).font(.headline).foregroundStyle(.primary).lineLimit(2)
                Text("^[\(project.clipCount) clip](inflect: true)")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text(project.updatedDate, style: .relative)
                    .font(.subheadline).foregroundStyle(.secondary)
                if project.aiRunning {
                    Label("Working", systemImage: "circle.dotted")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
