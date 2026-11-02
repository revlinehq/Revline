import SwiftUI

struct ProjectRow: View {
    let project: ProjectSummary
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 12) {
            MediaThumbnail(url: project.coverUrl, kind: project.coverKind)
                .frame(width: 80, height: 60)
                .clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(project.title).font(.headline).foregroundStyle(Color.revlineForeground).lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                Text("^[\(project.clipCount) clip](inflect: true)")
                    .font(.subheadline).foregroundStyle(Color.revlineMuted)
                Text(project.updatedDate, format: .relative(presentation: .named, unitsStyle: .abbreviated))
                    .font(.subheadline).foregroundStyle(Color.revlineMuted)
                if project.aiRunning {
                    Label("Working", systemImage: "circle.dotted")
                        .font(.subheadline).foregroundStyle(Color.revlineMuted)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
