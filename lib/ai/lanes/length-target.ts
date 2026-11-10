/** A finished length the user asked for, in seconds. Either bound may be open. */
export type LengthTarget = { min?: number; max?: number };

const UNIT = '\\s*-?\\s*(s|secs?|seconds?|min|mins|minutes?)\\b';
// A length is about the finished video; "remove 40 to 50 seconds" or "at 12 seconds" names a place in it.
const PLACE = /\b(remove|delete|cut out|take out|trim off|chop|skip|mute|from|at|after|before|first|last|until|till)\s+(?:the\s+|about\s+)?$/;
const LENGTH_CONTEXT = /\b(reels?|shorts?|tiktoks?|rough|video|cut|edit|long|length|duration|version|make|keep|trim|under|around|about)\b/;

const inSeconds = (value: string, unit: string) => Number(value) * (unit.startsWith('m') ? 60 : 1);
const valid = (value: number) => Number.isFinite(value) && value >= 5 && value <= 900;

/** The length a request asks for ("40 to 50 seconds", "under a minute", "about 45s"); undefined when it names none. */
export function requestedLength(request: string): LengthTarget | undefined {
  const text = request.toLowerCase().replace(/[–—]/g, '-').replace(/\ba minute\b/g, '1 minute').replace(/\ba second\b/g, '1 second');
  if (!LENGTH_CONTEXT.test(text)) return undefined;
  const placed = (index: number) => PLACE.test(text.slice(Math.max(0, index - 28), index));
  const range = new RegExp(`(\\d{1,3})\\s*(?:-|to|and)\\s*(\\d{1,3})${UNIT}`).exec(text);
  if (range && !placed(range.index)) {
    const min = inSeconds(range[1], range[3]), max = inSeconds(range[2], range[3]);
    if (valid(min) && valid(max) && max > min) return { min, max };
  }
  const bound = (pattern: string) => { const match = new RegExp(`\\b(?:${pattern})\\s+(\\d{1,3})${UNIT}`).exec(text); const value = match ? inSeconds(match[1], match[2]) : NaN; return valid(value) ? value : undefined; };
  const max = bound('under|below|less than|shorter than|no more than|no longer than|at most|max|maximum|maximum of|max of|up to|within');
  const min = bound('at least|over|longer than|more than|minimum|minimum of');
  if (max !== undefined || min !== undefined) return { ...(min !== undefined && (max === undefined || min < max) ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  const about = new RegExp(`\\b(?:about|around|roughly|approximately|approx)\\s+(\\d{1,3})${UNIT}`).exec(text)
    ?? new RegExp(`(\\d{1,3})${UNIT}\\s+(?:reel|short|video|cut|version|tiktok|edit)\\b`).exec(text)
    ?? new RegExp(`\\b(?:reel|short|video|cut|version|it)\\s+(?:to|of|at|be)\\s+(\\d{1,3})${UNIT}`).exec(text);
  if (about && !placed(about.index)) {
    const value = inSeconds(about[1], about[2]), slack = Math.max(3, value * .12);
    if (valid(value)) return { min: Math.round(value - slack), max: Math.round(value + slack) };
  }
  return undefined;
}

export function formatLength(target: LengthTarget) {
  return target.min !== undefined && target.max !== undefined ? `${target.min}-${target.max} s` : target.max !== undefined ? `at most ${target.max} s` : `at least ${target.min} s`;
}
