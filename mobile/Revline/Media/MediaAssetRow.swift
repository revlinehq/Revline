import SwiftUI

struct MediaAssetRow: View {
    let asset: MediaAsset
    let attached: Bool

    var body: some View {
        HStack(spacing: 12) {
            MediaThumbnail(url: asset.thumbnailUrl ?? asset.url, kind: asset.thumbnailUrl == nil ? asset.kind : "image")
                .frame(width: 64, height: 48).clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading) {
                Text(asset.fileName).lineLimit(2)
                Text(asset.preparation?.message ?? asset.kind.capitalized)
                    .font(.subheadline).foregroundStyle(Color.secondary).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: attached ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(attached ? Color.accentColor : Color.secondary)
                .accessibilityHidden(true)
        }.padding(.vertical, 4)
    }
}
