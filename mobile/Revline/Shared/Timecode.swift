import Foundation

func timecode(_ value: Double) -> String {
    let seconds = value.isFinite ? max(0, Int(value)) : 0
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}
