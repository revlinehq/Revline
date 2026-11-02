import ClerkKitUI
import SwiftUI

extension ClerkTheme {
    static var revline: ClerkTheme {
        var theme = ClerkTheme(colors: .init(
            background: .revlinePopover,
            input: .revlineCard,
            foreground: .revlineForeground,
            mutedForeground: .revlineMuted,
            inputForeground: .revlineForeground,
            muted: .revlinePopover,
            secondaryButtonBackground: .revlineCard
        ))
        theme.colors.border = .revlineBorder
        theme.colors.buttonBorder = .revlineBorder
        theme.colors.inputBorder = .revlineBorder
        return theme
    }
}
