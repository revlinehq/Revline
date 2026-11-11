import type { Timeline } from '../../editor/types';

/**
 * Caption checks that need no pixels: everything here is computed from the caption clips themselves. The words and
 * their sync against the transcript are checked by the reel lane (reel/check.ts); these are the layout and
 * readability rules, returned as advice with a pass. finish never asks for a frame to verify a caption.
 */
const MAX_LISTED = 6;
const seconds = (value: number) => `${Math.round(value * 100) / 100}`;

export function captionAdvice(timeline: Timeline): string[] {
  const captions = timeline.clips.filter((clip) => clip.kind === 'caption').sort((a, b) => a.start - b.start);
  if (!captions.length) return [];
  const frame = 1 / timeline.fps, advice: string[] = [];
  const list = (items: string[]) => `${items.slice(0, MAX_LISTED).join('; ')}${items.length > MAX_LISTED ? `; and ${items.length - MAX_LISTED} more` : ''}`;
  const name = (clip: Timeline['clips'][number]) => `${clip.id} ${JSON.stringify((clip.text ?? '').slice(0, 30))} at ${seconds(clip.start)} s`;

  // Two captions showing at once on one layer.
  const overlapping: string[] = [];
  for (let index = 1; index < captions.length; index++) {
    const previous = captions.slice(0, index).filter((clip) => (clip.track ?? 2) === (captions[index].track ?? 2)).at(-1);
    if (previous && captions[index].start < previous.start + previous.duration - frame / 2) overlapping.push(`${name(captions[index])} starts ${seconds(previous.start + previous.duration - captions[index].start)} s before ${previous.id} ends`);
  }
  if (overlapping.length) advice.push(`${overlapping.length} caption${overlapping.length === 1 ? '' : 's'} overlap the one before: ${list(overlapping)}. Set each start to the previous caption's end with setCaptionTiming.`);

  // On screen too briefly to read, or more text than the time allows (about 25 characters a second).
  const brief = captions.filter((clip) => clip.duration < 0.2 - frame / 2), fast = captions.filter((clip) => clip.duration >= 0.2 - frame / 2 && (clip.text ?? '').replace(/\s+/g, '').length / clip.duration > 25);
  if (brief.length) advice.push(`${brief.length} caption${brief.length === 1 ? ' shows' : 's show'} for under 0.2 s: ${list(brief.map((clip) => `${name(clip)} (${seconds(clip.duration)} s)`))}.`);
  if (fast.length) advice.push(`${fast.length} caption${fast.length === 1 ? ' reads' : 's read'} faster than 25 characters a second: ${list(fast.map((clip) => `${name(clip)} (${Math.round((clip.text ?? '').replace(/\s+/g, '').length / clip.duration)}/s)`))}.`);

  // Line length and count for the frame's shape.
  const widest = timeline.aspectRatio === 'landscape' ? 60 : 36;
  const long = captions.filter((clip) => (clip.text ?? '').split('\n').some((line) => line.length > widest) || (clip.text ?? '').split('\n').length > 3);
  if (long.length) advice.push(`${long.length} caption${long.length === 1 ? ' has' : 's have'} a line over ${widest} characters or more than 3 lines for this ${timeline.aspectRatio} frame: ${list(long.map(name))}.`);

  // Position against the frame and the app controls on a vertical frame.
  const low = timeline.aspectRatio === 'vertical' ? 0.8 : 0.95;
  const outside = captions.filter((clip) => (clip.x ?? 0.5) < 0.08 || (clip.x ?? 0.5) > 0.92 || (clip.y ?? 0.78) < 0.05 || (clip.y ?? 0.78) > low);
  if (outside.length) advice.push(`${outside.length} caption${outside.length === 1 ? ' sits' : 's sit'} outside the safe area${timeline.aspectRatio === 'vertical' ? ' (the bottom 20% of a vertical frame is under app controls)' : ''}: ${list(outside.map((clip) => `${name(clip)} (x ${seconds(clip.x ?? 0.5)}, y ${seconds(clip.y ?? 0.78)})`))}.`);

  // One caption track, one style: the odd ones out are named.
  const style = (clip: Timeline['clips'][number]) => JSON.stringify([clip.fontSize, clip.fontFamily, clip.color, clip.background, clip.x, clip.y, clip.textStyle ?? null, clip.textTemplate?.preset ?? null]);
  const counts = new Map<string, number>();
  for (const clip of captions) counts.set(style(clip), (counts.get(style(clip)) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0];
  const odd = captions.filter((clip) => style(clip) !== common[0]);
  if (odd.length && common[1] >= captions.length * 0.6) advice.push(`${odd.length} caption${odd.length === 1 ? ' differs' : 's differ'} in size, font, colour or position from the other ${common[1]}: ${list(odd.map(name))}.`);
  return advice;
}
