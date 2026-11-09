---
name: "music"
description: "Puts a song under an edit: where the song starts (its strongest moment), cutting on downbeats, beats or accents, edit length in whole 4/8-bar phrases, ending on a phrase end, and ducking under voice. Read before placing, trimming or cutting to any song, in every workflow."
---
# Music

A good music edit opens where the song gets good, cuts land on the song's own bar lines, the edit lasts whole phrases and ends where the music ends a phrase, and any voice stays on top. Every musical time comes from analyzeMusic, never from ear-guessing, a loudness scan by hand or bar maths.

Terms: a **beat** is one pulse (0.5 s at 120 BPM); a **bar** is beatsPerBar beats starting on a **downbeat** (2 s at 120 BPM in 4/4); a **phrase** is 4 or 8 bars (8 or 16 s at 120 BPM); a **moment** is a downbeat where analyzeMusic measured the energy arriving.

## Workflow
1. inspectTimeline: find the song's audio clip ID (or its asset ID in media if it is not placed yet; place it with addMedia).
2. analyzeMusic { clipId, lengths: [the target length] }: tempo, bars, sections, ranked moments and the best windows for that length. The first call measures the song (about 15–30 s); later calls read the saved result.
3. startMusicAt { clipId, moment: 1, length }: the song starts on moment 1's downbeat and lasts whole bars. Use sourceTime instead of moment for a window start or a user-named time.
4. Size each shot in whole bars or beats (Cutting), then alignCutsToBeat { musicAssetId } snaps every V1 cut to the nearest beat, which is the downbeat when the shot was sized in bars. Load skill music with loadCapability for alignCutsToBeat and markMusicBeats when they are not loaded yet.
5. Under voice, set the song's role and ducking with configureAudio (Voice).
6. Listen: getSound from 2 s before to 4 s after the song's timeline start, and over the last 4 s (Checks).
7. finish.

## Choosing the start
| Request | Start |
| --- | --- |
| No start named (default) | moment 1, the strongest: `startMusicAt { moment: 1 }` |
| "From the start", "with the intro" | Source 0, or the first downbeat when the song opens with a pickup |
| A visual payoff at timeline T (a reveal, a kill, a logo) | The moment minus T, in whole bars, so the moment lands on the payoff: `startMusicAt { sourceTime: moment.time - T }` snaps to the nearest downbeat |
| A user-named time ("start at the chorus", "at 2:43") | `startMusicAt { sourceTime: 163 }`; it snaps to the nearest downbeat |
| A target length | The top window for that length: `startMusicAt { sourceTime: window.start, length }` |
| A recreation with matchMusic | Keep the start matchMusic chose: it follows the reference's energy and downbeats |

- Prefer a moment with a sung line (`sung`) when two moments score within 0.1 of each other: a recognisable hook beats a slightly louder bar.
- A moment with jumpDb under 3 and lowJumpDb under 6 is not a real arrival; say the song stays level and start on the top window instead.
- Times in analyzeMusic are SOURCE seconds; `timeline` and `inClip` give where they play now. Never mix the two.

## Cutting
| Cut on | When | Shot length at 120 BPM |
| --- | --- | --- |
| Downbeats (bar lines) | Default for every scene or shot change; section changes always | 1, 2 or 4 bars: 2, 4 or 8 s |
| Beats | Fast montage shots of 1–2 beats, only inside a loud section (peak or drop) | 0.5–1 s |
| Accents | Not cuts: flashes, zooms or shakes on strong hits (strength 0.8 or more), at most 1 per bar | an instant |

- Change pace at section lines: hold longer shots (2–4 bars) in low and build sections, cut faster (1 bar or beats) in peak and drop sections.
- The biggest picture change (the reveal, the first action shot) goes on moment 1's downbeat.
- A cut is on the beat when it sits within 1 frame of it; alignCutsToBeat does this for V1. A film made with addFilm is one clip: move its section() start times to the downbeat times in code instead.
- Accents for effects come from markMusicBeats { kind: "accents" } or setAudioReactive mode accents, never from every beat.

## Length and ending
- Edit length is whole phrases: 4, 8 or 16 bars. At 128 BPM a bar is 1.875 s, so 8 bars = 15 s and 16 bars = 30 s. analyzeMusic returns `phraseSeconds` and windows already in whole bars.
- When the requested length is not a whole phrase, use the phrase nearest to it and say so ("16 bars is 28.7 s, closest to the 30 s you asked for"), unless the user fixed the length exactly; then end on a downbeat and fade out (below).
- End on a section end or a phrase end (the window's `endsOn`). A hard ending on a section end needs no fade.
- An ending mid-section gets a fade out of 1–2 bars (2–4 s at 120 BPM) with configureAudio fadeOut. Never cut a song off mid-bar.
- The last picture cut and the song's end land on the same downbeat.

## Voice
- Song under speech or narration: configureAudio { role: "music", ducking: { enabled: true, amount: 0.65 } } (about 9 dB lower under the voice, attack 0.12 s, release 0.25 s), and the voice clip labelled role voice.
- Several clips needing the same change (every voice clip labelled voice, a song split into pieces) take one call with clipIds, not one call per clip.
- Music volume under a voice starts at 0.25–0.35; a music-only edit keeps volume 1.
- Keep moment 1 off spoken words where possible: a drop under a sentence masks it. Move the moment into a pause, or start one bar later.

## Checks
- getSound around the start: the onsets and momentary loudness rise within 0.1 s of the song's timeline start, by about the moment's jumpDb. If the rise is a bar early or late, the clip moved: run startMusicAt again.
- getSound over the last 4 s: the song ends on its last bar, with no sound cut mid-onset (a fade or a section end).
- With voice: getSound over a spoken stretch shows the words, and no music onset is louder than the voice level there.
- Report the start the way a person hears it: "The song starts on its chorus at 2:43 (bar 81, +7.9 dB, 'I'm beggin', beggin' you')", not the tool's raw numbers.

## Example
"Put Beggin' under this 30 s montage" (a 134 BPM song on A1, montage of 9 shots on V1):

```
inspectTimeline                                   → song clip a1 (asset s1), V1 shots
analyzeMusic { clipId: "a1", lengths: [30] }      → bar 1.791 s; moment 1 at 163.2 s, bar 92, +7.9 dB, low band +9.4 dB,
                                                     sung "I'm beggin', beggin' you"; window 30: 163.2–191.9 s, 16 bars, ends a section
startMusicAt { clipId: "a1", moment: 1, length: 30 } → source 163.2–191.86 s, 16 bars, timeline 0–28.66 s
alignCutsToBeat { musicAssetId: "s1" }            → 8 cuts and the end snapped to downbeats
getSound { start: 0, end: 4 }                     → onsets and loudness rise at 0.0 s
getSound { start: 24.66, end: 28.66 }             → ends on the section end
finish
```

Reply: "The montage now opens on the chorus at 2:43 ('I'm beggin', beggin' you') and runs 16 bars, 28.7 s, closest to your 30 s, ending where the chorus ends. All 8 cuts land on bar lines."
