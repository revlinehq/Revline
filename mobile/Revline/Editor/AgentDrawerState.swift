import SwiftUI

@MainActor @Observable
final class AgentDrawerState {
    private(set) var expanded = false
    private(set) var fullHeight = false
    private(set) var composing = false
    private(set) var exporting = false
    private var composerHeight: CGFloat = 120

    var compact: Bool { composing || !expanded }

    func height(in available: CGFloat) -> CGFloat {
        let available = max(0, available)
        if composing { return min(composerHeight, available) }
        let minimum = min(max(170, composerHeight + 44), available)
        let requested = exporting ? 440 : fullHeight ? available * 0.92 : expanded ? available * 0.52 : minimum
        return min(max(minimum, requested), max(minimum, available - 80))
    }

    func measureComposer(_ height: CGFloat) { composerHeight = (height / 4).rounded(.up) * 4 }
    func focusChanged(_ focused: Bool) { composing = focused && !exporting }
    func expandConversation() { composing = false; expanded = true; fullHeight = false }
    func collapse() { composing = false; expanded = false; fullHeight = false }
    func toggleConversation() { compact ? expandConversation() : collapse() }
    func dragEnded(_ translation: CGFloat) {
        if translation < -40 {
            if expanded { fullHeight = true }
            else { expandConversation() }
        } else if translation > 40 { collapse() }
    }
    func showExport() { composing = false; exporting = true }
    func closeExport() { exporting = false; collapse() }
}
