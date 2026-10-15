# Audio FX sources

32 sounds: 24 curated, unmodified Ogg Vorbis files from Kenney’s Interface Sounds 1.0 and Impact Sounds 1.0, plus 8 original Revline whooshes and risers. Original Kenney licenses and the separate Revline CC0 dedication are included here.

- Interface Sounds: https://kenney.nl/assets/interface-sounds
- Impact Sounds: https://kenney.nl/assets/impact-sounds
- Kenney usage/attribution: https://kenney.nl/support
- CC0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode

Downloaded 2026-10-15 from the official pack links. The 24 Kenney source bytes are unmodified. The 8 Revline originals are synthesized locally by `scripts/author-stock-audio.mjs` from deterministic filtered noise and ascending sine harmonics; they contain no samples, AI output or third-party sounds. They are clearly labeled `Revline originals` in the catalog and dedicated to CC0. Their shaped envelopes, stereo width and peak/RMS limits are authored in the script. Do not describe them as Kenney sounds. Names describe the source material; all source filenames and SHA-256 hashes are in `lib/editor/stock-audio-catalog.json`. Byte-identical catalog objects are uploaded once to the existing shared R2 bucket. Project assets hold references; they do not duplicate or charge these stock files to user cloud storage.

| Audio FX name | Pack | Original file | Duration |
| --- | --- | --- | --- |
| Click | interface | Audio/click_001.ogg | 0.100 s |
| Back click | interface | Audio/back_003.ogg | 0.093 s |
| Toggle click 1 | interface | Audio/toggle_001.ogg | 0.139 s |
| Toggle click 2 | interface | Audio/toggle_002.ogg | 0.139 s |
| Select tone | interface | Audio/select_003.ogg | 0.383 s |
| Switch | interface | Audio/switch_003.ogg | 0.500 s |
| Drop pop 1 | interface | Audio/drop_001.ogg | 0.110 s |
| Drop pop 2 | interface | Audio/drop_004.ogg | 0.287 s |
| Pluck | interface | Audio/pluck_001.ogg | 0.102 s |
| Confirm tone | interface | Audio/confirmation_001.ogg | 0.290 s |
| Glass ping | interface | Audio/glass_002.ogg | 0.125 s |
| Open | interface | Audio/open_001.ogg | 0.148 s |
| Close | interface | Audio/close_001.ogg | 0.148 s |
| Expand | interface | Audio/maximize_004.ogg | 0.418 s |
| Contract | interface | Audio/minimize_004.ogg | 0.418 s |
| Light hit | impact | Audio/impactGeneric_light_000.ogg | 0.139 s |
| Metal hit | impact | Audio/impactMetal_medium_000.ogg | 0.272 s |
| Wood tap | impact | Audio/impactWood_light_000.ogg | 0.266 s |
| Wood knock | impact | Audio/impactWood_heavy_000.ogg | 0.313 s |
| Punch hit | impact | Audio/impactPunch_medium_000.ogg | 0.431 s |
| Heavy punch | impact | Audio/impactPunch_heavy_000.ogg | 0.649 s |
| Soft impact | impact | Audio/impactSoft_medium_000.ogg | 0.118 s |
| Glass tap | impact | Audio/impactGlass_light_000.ogg | 0.210 s |
| Bell hit | impact | Audio/impactBell_heavy_000.ogg | 1.480 s |

## Revline originals

Run `node scripts/author-stock-audio.mjs` to regenerate the original sounds and measured waveforms with ffmpeg/libvorbis. Each sound has an immutable content-hash R2 key.

| Name | Duration | Design |
| --- | --- | --- |
| Light whoosh |0.48s|Light moving-band noise sweep|
| Fast whoosh |0.32s|Short fast noise sweep|
| Air whoosh |0.95s|Wide high-frequency air sweep|
| Deep whoosh |1.15s|Low moving-band noise and quiet low tone|
| Short riser |2s|Compact upward noise/pitch build|
| Air riser |2.5s|Airy filtered-noise build|
| Tonal riser |3s|Noise and ascending harmonics|
| Deep riser |4s|Low-to-mid build with ascending harmonics|
