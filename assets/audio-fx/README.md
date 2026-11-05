# Audio FX sources

70 sounds: 24 curated, unmodified Ogg Vorbis files from Kenney’s Interface Sounds 1.0 and Impact Sounds 1.0, 8 original Revline whooshes and risers, 33 CC0 recordings from Freesound and 5 Revline designed sounds. Original Kenney licenses, the Freesound source list and the Revline CC0 dedications are included here. Every sound is CC0, so all of them are safe to publish commercially.

- Interface Sounds: https://kenney.nl/assets/interface-sounds
- Impact Sounds: https://kenney.nl/assets/impact-sounds
- Kenney usage/attribution: https://kenney.nl/support
- CC0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode

Downloaded 2026-10-15 from the official pack links. The 24 Kenney source bytes are unmodified. The 8 Revline originals are synthesized locally by `scripts/archive/author-stock-audio.mjs` from deterministic filtered noise and ascending sine harmonics; they contain no samples, AI output or third-party sounds. They are clearly labeled `Revline originals` in the catalog and dedicated to CC0. Their shaped envelopes, stereo width and peak/RMS limits are authored in the script. Do not describe them as Kenney sounds. Names describe the source material; all source filenames and SHA-256 hashes are in `lib/editor/stock-audio-catalog.json`. Byte-identical catalog objects are uploaded once to the existing shared R2 bucket. Project assets hold references; they do not duplicate or charge these stock files to user cloud storage.

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

Run `node scripts/archive/author-stock-audio.mjs` to regenerate the original sounds and measured waveforms with ffmpeg/libvorbis. Each sound has an immutable content-hash R2 key.

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

## Freesound CC0

33 CC0 1.0 recordings from Freesound (`sfx-29`–`sfx-61` of the video-edit skill's sound folder), cut from the Freesound previews and re-encoded as Ogg Opus by `scripts/author-library-audio.mjs`. The script refuses any entry whose source catalog licence is not `CC0 1.0`, whose rights status is not `cc0_freesound`, or whose bytes no longer match the recorded SHA-256. That folder's `sfx-01`–`sfx-28` (meme and Instagram sounds with unverified rights) are deliberately excluded. Uploaders and links are in `LICENSE-Freesound-CC0.txt` and the catalog's `creator`/`sourceUrl`. The cuts were checked by label, waveform and measurement, not by ear; the six `Ambience` beds have faded ends rather than seamless loops.

| Name | Category | Duration | Uploader |
| --- | --- | --- | --- |
| Bubble burst | Textures | 1.71 s | ristooooo1 |
| Water plunge | Textures | 1.71 s | adviseme333 |
| Wooden creak | Textures | 2.89 s | laft2k |
| Lock clunk | Clicks | 0.33 s | Vrymaa |
| Padlock click | Clicks | 0.27 s | Rudmer_Rotteveel |
| Vault clank | Hits | 1.22 s | AudioPapkin |
| Servo motor | Textures | 1.25 s | JoontheFloof |
| Blade slice | Whooshes | 0.66 s | SamuelGremaud |
| Phone buzz | Textures | 1.59 s | steeltowngaming |
| Screen tap | Clicks | 0.10 s | vacuumfan7072 |
| Clock ticking | Textures | 11.96 s | felix.blume |
| Card riffle | Textures | 1.51 s | Kodack |
| Glass ting | Pops & tones | 2.60 s | fleurescence |
| Electric zap | Transitions | 0.24 s | michael_grinnell |
| Spark crackle | Textures | 1.45 s | weaveofkev |
| Switch clack | Clicks | 0.37 s | Deathscyp |
| Wing flutter | Textures | 2.01 s | TRP |
| Quick swish | Whooshes | 0.43 s | qubodup |
| Low rumble whoosh | Whooshes | 2.66 s | Paul368 |
| Deep boom | Hits | 5.01 s | rhapsodize |
| Camera shutter | Clicks | 0.43 s | xef6 |
| Sonar ping | Pops & tones | 1.96 s | Peter_Gross |
| Distant foghorn | Pops & tones | 6.23 s | Danjocross |
| Rope pulley | Textures | 3.45 s | mikewest |
| Tiles falling | Textures | 2.26 s | Detective_Lemons |
| Soft pop | Pops & tones | 0.07 s | ImAFoley |
| Rubber stamp | Hits | 0.46 s | I.fekry |
| Underwater bed | Ambience | 31.01 s | jhumbucker |
| City night bed | Ambience | 31.01 s | janbezouska |
| Server room bed | Ambience | 31.01 s | Nox_Sound |
| Hull water bed | Ambience | 23.01 s | Pfannkuchn |
| Electrical hum bed | Ambience | 26.01 s | kyles |
| Radio static bed | Ambience | 31.01 s | Cloud-10 |

## Revline designed

Five sounds synthesized by `scripts/author-library-audio.mjs`, a port of the matching functions in cstack's MIT-licensed `designed.py`. They contain no samples and are dedicated to CC0 (`LICENSE-Revline-designed.txt`). Run `node --import tsx scripts/author-library-audio.mjs --freesound <video-edit assets/sfx>` to rebuild both packs; the output is deterministic. New sounds are Ogg Opus because current Homebrew ffmpeg ships without libvorbis.

| Name | Category | Duration |
| --- | --- | --- |
| Synth pop | Pops & tones | 0.06 s |
| Panning whoosh | Whooshes | 0.58 s |
| Single tick | Clicks | 0.36 s |
| Soft chime | Pops & tones | 3.66 s |
| Soft thud | Hits | 0.50 s |
