import type { EditorSkill } from './index';

export const soundDesign: EditorSkill = {
  name: 'sound-design',
  description: 'Place sound effects from the CC0 Audio FX library: whooshes on cuts, pops and clicks on UI and text reveals, hits on reveals, ambience beds. Covers when to add sound, restraint around speech and gain levels. Read before addSoundEffect.',
  body: `# Sound design

Sound effects make edits feel deliberate. Each one marks a visual event the viewer already sees. Every sound in the library is CC0 and safe to publish commercially. Use only ids listed under \`soundEffects\` in the catalog; there is no other source and nothing is generated on request.

## Tool

\`addSoundEffect({ effect, at, gain? })\` places the whole sound at timeline seconds \`at\` on a free A layer. Library sounds share one layer above the footage audio when it is free. \`gain\` is the clip volume: 1 is the file's own level and the default is 0.7. To change one afterwards, use \`setVolume\`, \`trim\`, \`move\` or \`delete\` with the returned \`clipId\`. The result lists \`overlapsAudio\`: the non-library audio clips it plays over.

## When to use sound

- **Cuts and scene changes.** A whoosh lands its loudest part on the cut, so start it slightly before. For a 0.4–0.6 s whoosh, set \`at\` to the cut minus about 0.2 s; for a long whoosh, minus about 40% of its length. A hard cut can be sold with a hit or a thud right on the cut instead.
- **Scene beats.** Key sounds to the beat times in the scene code: a pop or soft pop when a card or bubble appears, a tick for each counter step or list item, a chime when something completes or succeeds, a thud or stamp when something lands or locks into place.
- **UI walkthroughs.** A click or screen tap exactly on each button press, toggle or cursor click. A camera shutter for a screenshot or capture.
- **Text reveals.** One pop or tick when a title or caption block appears, not one per word. A riser that ends on the reveal suits a big title; the riser's end is \`at + duration\`.
- **Ambience beds.** A bed (category Ambience) sets a place under a whole scene with no speech. Their ends are faded rather than seamless, so trim them to the scene instead of looping.

## Restraint

- One sound per beat. Never stack two effects on the same moment; pick the one that fits.
- Leave space. Skip small beats when they come quicker than about 0.5 s apart, or the edit sounds busy. Not every cut needs a whoosh: use them for topic or scene changes, not every jump cut inside one shot.
- Nothing under speech. Check transcript word times (inspectAssetAnalysis) and place effects in pauses, before the first word or after a sentence ends. If \`overlapsAudio\` lists a voice clip and a word is spoken there, move the sound to the nearest pause or drop it.
- Match the tone. A calm explainer gets soft pops, ticks and chimes at low gain. Hits, booms and fast whooshes are for energetic edits.
- Add sounds only when the user asks for sound or authorized creative styling. Say which sounds you placed and where.

## Gain levels

Library files peak near -3 dBFS, so gain decides how loud an effect sits in the mix.

| Use | gain |
| --- | --- |
| Clicks, taps, ticks, pops near or between speech | 0.3–0.5 |
| Whooshes, chimes, risers on cuts with no speech | 0.6–0.8 |
| Hits, booms, a riser into a big reveal | 0.7–1.0 |
| Ambience beds | 0.15–0.3 |

Never exceed 1.2. Deep sounds (Deep boom, Low rumble whoosh, Deep whoosh) sit mostly below 120 Hz, which phone speakers barely play: pair one with a brighter hit, or pick another sound for short-form video.

## Example

The user asks for a whoosh at each scene cut. Read the timeline, list the cut times between scenes, then for each cut call \`addSoundEffect({ effect: 'whoosh-light', at: cut - 0.2, gain: 0.7 })\`. Reuse the same whoosh so cuts feel consistent, or alternate two similar whooshes when there are many. Report the cut times you covered.
`,
};
