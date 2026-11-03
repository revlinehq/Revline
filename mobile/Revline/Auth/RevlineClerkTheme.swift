import ClerkKitUI
import SwiftUI

extension ClerkTheme {
    static var revline: ClerkTheme {
        var theme = ClerkTheme(colors: .init(
            primary: .accentColor,
            background: .revlineBackground,
            input: .revlineCard,
            foreground: .primary,
            mutedForeground: .secondary,
            primaryForeground: .primary,
            inputForeground: .primary,
            muted: .revlinePopover,
            secondaryButtonBackground: .revlineCard
        ))
        theme.colors.border = .revlineBorder
        theme.colors.buttonBorder = .revlineBorder
        theme.colors.inputBorder = .revlineBorder
        return theme
    }
}
