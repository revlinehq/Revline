import { SOUND_PRESETS } from '../../audio/presets';
import { SOUND_RECIPE_LIMITS } from '../../audio/sound-recipe';
import type { EditorSkill } from './index';

const presetTable = Object.entries(SOUND_PRESETS).map(([name, spec]) => `| \`${name}\` | ${spec.description} | ${Object.keys(spec.params.shape).join(', ') || '—'} |`).join('\n');

export const soundDesign: EditorSkill = {
  name: 'sound-design',
  description: 'Add sound effects, including the sound every new or reworked scene gets: generate every sound by default with generateSound/editSound, keyed to a scene\'s beat times (whoosh on a slide-in, pop per card, riser into a hit); restraint around speech and gain. Library recordings only on explicit request. Read before generateSound, editSound or addSoundEffect.',
  body: `# Sound design

Sound effects make edits feel deliberate: each one marks a visual event the viewer already sees. **Generate every sound by default** with \`generateSound\`, timed to the exact beats of the motion: a whoosh as long as a slide-in, one pop per card, a counter while a number counts, a riser that ends on a reveal. Change one with \`editSound\`. Generated sounds are rendered from a recipe, contain no samples, and are safe to publish.

The recorded library (\`soundEffects.library\`, placed with \`addSoundEffect\`) is **only** for when the user explicitly asks for a realistic or recorded sound, such as a camera shutter, a phone vibrating, a clock ticking, a lock, water or bubbles, or ambience like a city, the ocean or a server room, or names a library sound. Never add a library sound on your own initiative, and never mix library sounds into motion-graphics sound design. If the user asks for a recording the library does not have (for example keyboard typing), say there is no recorded one and generate the closest sound, labeled as synthesized.

## Scenes

Motion design comes with sound. When you add a scene, or change a scene's choreography with editScene, generate its sound in the same turn without being asked:

- One generateSound clip per scene at the scene's start, layered on its key beats only.
- When editScene changes a scene's timing, change its existing generated clip with editSound to the new beats; never add a second clip for the same scene. Leave other scenes' sounds alone.
- Skip it if the user asked for no sound or silence, or speech or music plays under the scene. Library recordings stay request-only, even for scenes.

## Timing

- When the user gives a time ("at 3.2 s"), place the sound at exactly that timeline time; tools snap it to the nearest frame. Do not shift it to a nearby beat.
- When the user says "when X happens", find that moment: read the scene code (inspectClip) for its beat times, or the timeline and transcript for cuts and words, then place the sound there.
- Otherwise key every sound to the motion's beats as below.

## Find the beats

Read the scene clip's code (inspectClip). Times inside a scene are clip-local seconds, so a beat at local \`t\` is at timeline \`clip.start + t\`.

- \`enter(start, duration = .6)\` eases out (fastest at its start): the motion is mostly done in the first third. Start a whoosh at \`start\` with \`duration\` equal to the enter duration and \`peak\` about 0.25.
- \`draw(start, duration = .8)\` eases in and out (fastest midway): a whoosh or riser spanning the draw, \`peak\` 0.5.
- \`pop(start, duration = .45)\` overshoots: put a \`pop\` or \`blip\` at \`start\`; the element appears then.
- \`<Show from={a} to={b}>\` is a hard cut: a \`tick\`, \`pop\` or \`thud\` exactly at \`a\`.
- \`interpolate(t, [t0, t1, ...], ...)\` keyframes: sounds land on the keyframe times where motion starts or stops.
- Staggered items (\`i * .12\` offsets) need one short sound per item, at each item's own time. Vary pitch slightly (\`frequency\` or \`note\`) instead of repeating the identical sound.

Prefer one generateSound per scene beat group: the whole scene's sounds in one recipe with \`at\` set to the scene's start, so layer times equal scene-local beat times. Keep separate clips only when sounds need separate gains or later edits.

## Recipe

\`\`\`json
{ "duration": 2.4,
  "reverb": { "decay": 1.2, "wet": 0.15 },
  "layers": [
    { "at": 0.0, "preset": "whoosh", "params": { "duration": 0.6, "peak": 0.25 } },
    { "at": 0.9, "preset": "pop", "params": { "frequency": 520 } },
    { "at": 1.02, "preset": "pop", "params": { "frequency": 600 }, "gain": -2 },
    { "at": 1.4, "preset": "riser", "params": { "duration": 0.7, "to": "C6" } },
    { "at": 2.1, "preset": "impact", "gain": -4 }
  ] }
\`\`\`

- \`duration\` (≤ ${SOUND_RECIPE_LIMITS.duration} s) is the exact clip length; tails past it are faded off. Up to ${SOUND_RECIPE_LIMITS.layers} layers; \`at\` is seconds from the clip start.
- A **preset layer** is \`{ at, preset, params? }\` using the table below. Omitted params keep the designed default.
- A **synth layer** is \`{ at, source, length, frequency?, partials?, fm?, envelope?, tremolo?, seed? }\`. \`source\` is sine, triangle, square, saw, white or pink. Oscillators need \`frequency\` in Hz.
- Every layer also takes \`gain\` (dB, default 0), \`pan\` (-1 left … 1 right), \`filters\` (up to 4 of \`{ type: lowpass|highpass|bandpass, frequency, q? }\`), \`distortion\` (drive 0–10), \`delay\` (\`{ time, feedback?, wet?, taps? }\`) and \`reverb\` (\`{ decay ≤ 4, wet?, bright? }\`). Recipe-level \`reverb\` glues all layers; use at most ${SOUND_RECIPE_LIMITS.reverbs} reverbs.
- **Curves.** \`frequency\`, \`pan\`, filter \`frequency\`, \`fm.index\` and \`tremolo.rate\` take a number, \`{ from, to, shape?, power? }\` across the layer (frequencies glide exponentially), or \`{ points: [{ time, value }, ...] }\` in layer seconds.
- **Envelope** \`{ attack = .005, hold = 0, decay?, release = .01 }\`: \`decay\` is an exponential time constant after attack + hold; without it the layer sustains until its release.
- \`partials\` (sine only): \`[{ ratio, gain, decay? }]\` builds bells and organ tones. \`fm: { ratio, index }\` adds sidebands; a falling index gives a pluck.
- The render is normalized to a -3 dBFS peak, so layer gains set the balance and the tool's \`gain\` sets the clip level (see Gain).

Synth examples: a soft tap \`{ "source": "sine", "length": 0.08, "frequency": { "from": 1400, "to": 700 }, "envelope": { "decay": 0.02 } }\`; a low swell \`{ "source": "saw", "length": 1.2, "frequency": 55, "filters": [{ "type": "lowpass", "frequency": { "from": 200, "to": 2400 } }], "envelope": { "attack": 1, "release": 0.2 }, "gain": -10 }\`; a laser \`{ "source": "square", "length": 0.25, "frequency": { "from": 3000, "to": 300 }, "envelope": { "decay": 0.08 }, "gain": -12 }\`.

## Presets

| Preset | Sound | Params |
| --- | --- | --- |
${presetTable}

Notes are names like \`F5\` or Hz. Keep pitched sounds in one key across a video (the defaults sit in F minor) so pops, chimes and blips feel related.

## Restraint

- One sound per beat. Never stack two sounds on the same moment; pick the one that fits.
- Leave space. Skip small beats quicker than about 0.5 s apart, or the edit sounds busy. Not every cut needs a whoosh: use them for topic or scene changes, not every jump cut inside one shot.
- Nothing under speech. Check transcript word times (inspectAssetAnalysis) and place sounds in pauses, before the first word or after a sentence ends. If a tool result's \`overlapsAudio\` lists a voice clip with a word spoken there, move the sound to the nearest pause or drop it.
- Match the tone. A calm explainer gets soft pops, ticks and chimes at low gain; hits, booms and fast whooshes are for energetic edits. Deep sounds below about 120 Hz barely play on phone speakers: pair a sub-drop with a brighter layer.
- Add sounds when the user asks for sound, authorizes creative styling, or asks for motion design: every scene you create or rework gets one generated clip for its key beats in the same turn (see Scenes). Otherwise do not decorate. Say which sounds you placed and where.

## Gain

Generated and library sounds both peak near -3 dBFS, so the tool's \`gain\` (clip volume) sets the level: clicks, taps, ticks and pops near speech 0.3–0.5; whooshes, chimes and risers with no speech 0.6–0.8; hits and a riser into a big reveal 0.7–1.0; ambience beds 0.15–0.3. Never exceed 1.2.

## Library sounds on request

\`addSoundEffect({ effect, at, gain? })\` places a recorded library sound by id from \`soundEffects.library\` at its full length. Use it only for an explicit request as above, at the user's time or the moment they describe. Pick the match by name and tags (shutter, phone, clock, lock, water, city, ocean, server room) and say which sound you used; when nothing matches, follow the rule above instead of substituting an unrelated recording. Ambience beds (category Ambience) have faded ends: trim them to the scene instead of looping.

## Editing

\`inspectClip\` on a generated clip returns its \`soundRecipe\`. Change the recipe and call \`editSound\` with the whole new recipe; the clip keeps its start, layer and volume. When the scene's timing changes (editScene), re-time its sounds the same turn. To move or re-level a sound use \`move\` or \`setVolume\`; to remove it use \`delete\`.

## Check

After placing, compare each layer's timeline time (\`clip.start + layer.at\`) with the beats you listed, and report the sounds and times. Say the result was synthesized and not listened to.
`,
};
