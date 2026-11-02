import SwiftUI

struct WorkingLabel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false
    var label = "Working"

    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(label).font(.subheadline)
                .foregroundStyle(.secondary)
                .overlay {
                    if !reduceMotion {
                        LinearGradient(colors: [.clear, .white.opacity(0.8), .clear], startPoint: .leading, endPoint: .trailing)
                            .offset(x: phase ? 100 : -100)
                            .mask(Text(label).font(.subheadline))
                    }
                }
        }
        .onAppear { if !reduceMotion { withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) { phase = true } } }
        .accessibilityLabel(label)
    }
}
