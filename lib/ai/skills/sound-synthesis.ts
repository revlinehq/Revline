import { SOUND_PRESETS } from '../../audio/presets';
import { SOUND_RECIPE_LIMITS } from '../../audio/sound-recipe';
import type { EditorSkill } from './index';

const presetTable = Object.entries(SOUND_PRESETS).map(([name, spec]) => `| \`${name}\` | ${spec.description} | ${Object.keys(spec.params.shape).join(', ') || '—'} |`).join('\n');

export const soundSynthesis: EditorSkill = {
  name: 'sound-synthesis',
  description: 'Design new sound effects timed exactly to motion graphics: write a JSON recipe of presets and synth layers keyed to a scene\'s beat times, render it with generateSound and change it with editSound. Read before generateSound or editSound; read sound-design too for restraint and gain.',
  body: `# Sound synthesis

\`generateSound\` renders a recipe into a WAV and places it like any audio clip. Use it when a sound must match motion exactly: a whoosh as long as a slide-in, one pop per card, a counter that runs while a number counts, a riser that ends on a reveal. Use library sounds (\`addSoundEffect\`) for realistic recordings such as typing, a camera shutter, a door or ambience, and when a stock whoosh or click already fits. The sound-design rules still apply: one sound per beat, nothing under speech, restrained gain.

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
- The render is normalized to a -3 dBFS peak, so layer gains set the balance and the tool's \`gain\` sets the clip level (sound-design table; 0.4–0.8 typical).

Synth examples: a soft tap \`{ "source": "sine", "length": 0.08, "frequency": { "from": 1400, "to": 700 }, "envelope": { "decay": 0.02 } }\`; a low swell \`{ "source": "saw", "length": 1.2, "frequency": 55, "filters": [{ "type": "lowpass", "frequency": { "from": 200, "to": 2400 } }], "envelope": { "attack": 1, "release": 0.2 }, "gain": -10 }\`; a laser \`{ "source": "square", "length": 0.25, "frequency": { "from": 3000, "to": 300 }, "envelope": { "decay": 0.08 }, "gain": -12 }\`.

## Presets

| Preset | Sound | Params |
| --- | --- | --- |
${presetTable}

Notes are names like \`F5\` or Hz. Keep pitched sounds in one key across a video (the defaults sit in F minor) so pops, chimes and blips feel related.

## Editing

\`inspectClip\` on a generated clip returns its \`soundRecipe\`. Change the recipe and call \`editSound\` with the whole new recipe; the clip keeps its start, layer and volume. When the scene's timing changes (editScene), re-time its sounds the same turn. To move or re-level a sound use \`move\` or \`setVolume\`; to remove it use \`delete\`.

## Check

After placing, compare each layer's timeline time (\`clip.start + layer.at\`) with the beats you listed, and report the sounds and times. Say the result was synthesized and not listened to.
`,
};
