import SwiftUI

struct AIConsentView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    var onComplete: () -> Void = { }
    var dismissOnCompletion = true
    @State private var agreed = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Your media, with your permission", systemImage: "hand.raised").font(.headline)
                    Text("To edit or prepare media, Revline sends relevant prompts, conversation and timeline context, selected video frames, audio, transcripts, images and source links to processing services.")
                }.revlineRows()
                Section("Who receives it") {
                    Text("OpenAI, Google Gemini, Anthropic, Deepgram, fal and ElevenLabs, depending on the operation. Revline also uses its own media servers, Convex and Cloudflare R2 for storage and delivery.")
                    Text("Not every request uses every provider. Their retention and data-use terms apply. Review the privacy policy before sharing sensitive footage.").foregroundStyle(Color.secondary)
                }.revlineRows()
                Section {
                    if session.aiConsentGranted {
                        Text("Permission is currently allowed. Withdrawing it stops future edit and import requests. Completed processing cannot be recalled.")
                        Button("Withdraw AI-sharing permission", role: .destructive) { Task { await update(false) } }
                            .disabled(busy)
                    } else {
                        Toggle("I allow this sharing to process my edits", isOn: $agreed)
                        Button { Task { await update(true) } } label: {
                            ActionLabel(title: "Allow and continue", busyTitle: "Saving permission…", busy: busy)
                        }.buttonStyle(.borderedProminent).disabled(!agreed || busy)
                    }
                }.revlineRows()
                if let error { Section { ErrorBanner(message: error) }.revlineRows() }
                Section { LegalLinks() }.revlineRows()
            }
            .revlineSurface(.revlinePopover)
            .navigationTitle("AI data sharing").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", action: dismiss.callAsFunction) } }
        }
        .presentationBackground(Color.revlinePopover)
    }

    private func update(_ accepted: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await session.setAIConsent(accepted)
            onComplete()
            if dismissOnCompletion { dismiss() }
        } catch { self.error = AppFailure.describe(error) }
    }
}
