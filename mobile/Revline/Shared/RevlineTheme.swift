import ClerkKitUI
import SwiftUI

enum RevlineTheme {
    static let background = Color(white: 0.055)
    static let surface = Color(white: 0.11)
    static let raised = Color(white: 0.165)
    static var clerk: ClerkTheme {
        var theme = ClerkTheme()
        theme.colors.primary = .white
        theme.colors.primaryForeground = .black
        theme.colors.background = background
        theme.colors.input = raised
        theme.colors.ring = .clear
        theme.colors.inputBorderFocused = .clear
        return theme
    }
}

extension View {
    func revlineClerkTheme() -> some View {
        environment(\.clerkTheme, RevlineTheme.clerk)
            .tint(.white).preferredColorScheme(.dark)
    }
}
