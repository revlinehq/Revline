import SwiftUI

struct ProjectCard: View {
    let project: ProjectSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MediaThumbnail(url: project.coverUrl, kind: project.coverKind)
                .frame(height: 120).clipShape(.rect(cornerRadius: 12))
                .overlay(alignment: .bottomLeading) {
                    if project.aiRunning {
                        Label("Working", systemImage: "circle.dotted")
                            .font(.caption2).padding(7)
                            .background(.black.opacity(0.8), in: .capsule).padding(8)
                    }
                }
            Text(project.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                .foregroundStyle(.primary)
            HStack(spacing: 4) {
                Text("\(project.clipCount) clips")
                Text("·")
                Text(project.updatedDate, style: .relative)
            }
            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}
