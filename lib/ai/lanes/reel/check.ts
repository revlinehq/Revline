import type { LaneCheckContext } from '../types';
export function check(_context: LaneCheckContext): string[] {
  return [];
}

/** Match caption text and phrase edges to retained measured words, including retiming. */
export function captionSyncFailures(
  timeline: import('../../../editor/types').Timeline,
  words: { text: string; start: number; end: number }[],
): string[] {
  const normalized = (text: string) =>
    text
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const captions = timeline.clips.filter((clip) => clip.kind === 'caption');
  const matched = new Set<number>(),
    failures: string[] = [],
    tolerance = Math.max(0.12, 2 / timeline.fps);
  for (const caption of captions) {
    const indices = words.flatMap((word, index) =>
      word.end > caption.start + tolerance / 4 &&
      word.start < caption.start + caption.duration - tolerance / 4
        ? [index]
        : [],
    );
    const spoken = indices.map((index) => words[index]);
    if (
      !spoken.length ||
      spoken.length > 8 ||
      normalized(caption.text ?? '') !==
        normalized(spoken.map((word) => word.text).join(' ')) ||
      Math.abs(caption.start - spoken[0].start) > tolerance ||
      Math.abs(caption.start + caption.duration - spoken.at(-1)!.end) >
        tolerance
    ) {
      failures.push(
        `Caption ${caption.id} does not match its spoken words and timing.`,
      );
      continue;
    }
    indices.forEach((index) => matched.add(index));
  }
  if (matched.size < words.length)
    failures.push(
      `${words.length - matched.size} spoken words lack synchronized captions.`,
    );
  return failures;
}
