/** Shared "eyes": measured face and motion signals around chosen moments, the flags they raise, and the budget
 * of frames a model may be shown. One implementation for every lane; each lane declares its own policy
 * (which spots, which flags, how many frames, what fails finish) in its definition. */

/** One measured source frame (lib/server/source-looks.ts). */
export type LookSample = { time: number; face: number; yaw: number | null; pitch: number | null; blink: number | null; down: number | null; side: number | null; motion: number | null };

export const EYE_FLAGS = ['no-face', 'head-away', 'eyes-down', 'eyes-off-camera', 'blink', 'reach', 'movement'] as const;
export type EyeFlag = (typeof EYE_FLAGS)[number];
const FLAG_TEXT: Record<EyeFlag, string> = {
  'no-face': 'no face in frame', 'head-away': 'head turned away', 'eyes-down': 'eyes down', 'eyes-off-camera': 'eyes off camera',
  blink: 'eyes closed (blink)', reach: 'leaning or reaching toward the camera', movement: 'large movement',
};

/** What a lane's eyes look at and what that costs. Declared next to the lane's check recipe. */
export type EyesPolicy = {
  /** speech-edges: start and end of every retained speech piece plus the first and last frame. clip-edges: each clip's first and last second. */
  spots: 'speech-edges' | 'clip-edges';
  /** The flags that count in this lane; others are measured and ignored. */
  flags: readonly EyeFlag[];
  /** Frames a model may be shown per request: per flagged spot on the first look, in the one extra round, for b-roll shots, and in total. */
  frames: { firstLook: number; extraRound: number; broll: number; total: number };
  /** Which unreviewed flags fail finish. The rest are reported with it. */
  failsFinish: 'first-and-last-frame' | 'none';
  /** enforced: tools and finish apply this policy. slot: declared for a later detector; nothing enforces it yet. */
  status: 'enforced' | 'slot';
};

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };

/** How this speaker normally sits in frame. A camera below eye level reads as a tilted head in every frame, so flags compare against this. */
export function lookBaseline(samples: LookSample[]) {
  const seen = samples.filter(sample => sample.face > 0);
  return { yaw: median(seen.flatMap(sample => sample.yaw ?? [])), pitch: median(seen.flatMap(sample => sample.pitch ?? [])), face: median(seen.map(sample => sample.face)), motion: median(samples.flatMap(sample => sample.motion ?? [])) };
}
export type LookBaseline = ReturnType<typeof lookBaseline>;

/** What is wrong with one frame as a place to cut. `near` are the samples just before and after, to tell a blink from a look down. */
export function sampleFlags(sample: LookSample, baseline: LookBaseline, near: (LookSample | undefined)[] = []): EyeFlag[] {
  if (sample.face <= 0) return ['no-face'];
  const flags: EyeFlag[] = [];
  if (sample.yaw !== null && Math.abs(sample.yaw - baseline.yaw) > 20 || sample.pitch !== null && Math.abs(sample.pitch - baseline.pitch) > 14) flags.push('head-away');
  const lowered = (item?: LookSample) => !!item && item.face > 0 && ((item.down ?? 0) > .5 || (item.blink ?? 0) > .5);
  if (lowered(sample)) flags.push(near.some(item => lowered(item) && Math.abs(item!.time - sample.time) <= .2 && Math.abs(item!.time - sample.time) >= .06) ? 'eyes-down' : 'blink');
  else if ((sample.side ?? 0) > .6) flags.push('eyes-off-camera');
  if (baseline.face > 0 && (sample.face > baseline.face * 1.22 || sample.face < baseline.face * .6)) flags.push('reach');
  if (sample.motion !== null && sample.motion > Math.max(.12, baseline.motion * 4)) flags.push('movement');
  return flags;
}

/** A blink passes in a frame or two: awkward to cut on, harmless inside the shot. Every other flag lasts. */
export const TRANSIENT_FLAGS: readonly EyeFlag[] = ['blink'];

/** "eyes down 12.3-12.9 s, large movement 13.0 s": consecutive flagged samples joined per flag. */
export function describeFlags(flagged: { time: number; flags: EyeFlag[] }[], step = .2) {
  const parts: string[] = [];
  for (const flag of EYE_FLAGS) {
    const times = flagged.filter(item => item.flags.includes(flag)).map(item => item.time).sort((a, b) => a - b);
    for (let index = 0; index < times.length; index++) {
      const from = times[index];
      while (index + 1 < times.length && times[index + 1] - times[index] <= step) index++;
      parts.push(`${FLAG_TEXT[flag]} ${from.toFixed(2)}${times[index] > from ? `-${times[index].toFixed(2)}` : ''} s`);
    }
  }
  return parts;
}

/** Frames shown to the model in one request. The server counts them; the model is told what is left. */
export class FrameBudget {
  constructor(readonly total: number, public used = 0) {}
  get left() { return Math.max(0, this.total - this.used); }
  /** Take up to `frames`, whole groups of `group` only (a strip is shown complete or not at all). */
  take(frames: number, group = 1) { const granted = Math.min(frames, Math.floor(this.left / group) * group); this.used += granted; return granted; }
  report() { return `used ${this.used} of ${this.total} frames`; }
}

/** Deployment switch, read where the server's environment is (Convex): REEL_LOOKS=off disables the looks read. Default on. */
export const looksSwitchedOff = (env: Record<string, string | undefined> = process.env) => env.REEL_LOOKS?.trim().toLowerCase() === 'off';
export const LOOKS_OFF = 'Look measurement is switched off on this server (REEL_LOOKS=off).';
/** What the reel lane says when no face measurement exists: a warning, never a failed check. */
export const LOOKS_UNMEASURED = 'cut edges could not be measured on this server; not verified';
