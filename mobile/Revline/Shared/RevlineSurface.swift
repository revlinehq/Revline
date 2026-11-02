import SwiftUI

struct RevlineSurface: ViewModifier {
    var background: Color

    func body(content: Content) -> some View {
        content
            .foregroundStyle(Color.revlineForeground)
            .scrollContentBackground(.hidden)
            .background(background)
            .toolbarBackground(background, for: .navigationBar, .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .toolbarColorScheme(.dark, for: .navigationBar, .tabBar)
    }
}

extension View {
    func revlineSurface(_ background: Color = .revlineBackground) -> some View {
        modifier(RevlineSurface(background: background))
    }

    func revlineRows() -> some View {
        listRowBackground(Color.revlineCard)
            .listRowSeparatorTint(.revlineBorder)
    }
}
