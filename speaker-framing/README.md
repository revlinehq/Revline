# Speaker framing screenshot provenance

- Baseline: origin/main at f8433b0997a4634a752012dbd1bdde8b4da36690, with the unmodified baseline CPU processor and its existing followSubject eligibility gate.
- Candidate implementation: 7b2f3f87 on speaker-framing. Candidate crop paths are from the kept development project Test: speaker framing.
- Both sides use the same source footage, saved clip geometry, source instant, and native Revline generateComposition renderer.
- Source instants: Lex 30.40 seconds; Dwarkesh 27.10 seconds; Syntax wide 32.283333 seconds.
- Desktop: 1440x1000. Phone: 390x844. The native composition is uniformly fitted within each viewport. This PR changes rendered crop behavior, not editor interface chrome.
- Served privately on 127.0.0.1:3008. Screenshots taken with Puppeteer headless Chrome for Testing using a fresh automation profile. The browser and private server were stopped after capture.
- No screenshot is mocked or manually retouched. No video export, deployment, or visible browser was used.
