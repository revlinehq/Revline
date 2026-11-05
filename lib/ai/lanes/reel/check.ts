import type { LaneCheckContext, LaneEvidence } from '../types';
import type { Timeline } from '../../../editor/types';
import type { Transcript } from '../../../media-analysis/transcript';
import { sourceEndOf, timelineTimeAtSource } from '../../../editor/playback-rate';
export function check(_context: LaneCheckContext): string[] {
  return [];
}

export function retainedSpeechWords(timeline: Timeline, assets: { _id: string; kind?: string; duration?: number; audioAssetId?: string; analysis?: { transcript?: Transcript } }[]) {
  const speech = timeline.clips.flatMap(clip => {
    if (clip.volume === 0 || !(clip.kind === 'audio' || clip.kind === 'video' && !clip.audioSeparated)) return [];
    const transcript = assets.find(asset => asset._id === clip.assetId)?.analysis?.transcript
      ?? assets.find(asset => asset.audioAssetId === clip.assetId)?.analysis?.transcript;
    return (transcript?.words ?? []).filter(word => word.start >= clip.sourceStart - .001 && word.end <= sourceEndOf(clip) + .001)
      .map(word => ({ text: word.text, start: timelineTimeAtSource(clip, word.start), end: timelineTimeAtSource(clip, word.end) }));
  });
  return [...new Map(speech.map(word => [`${word.start.toFixed(3)}:${word.end.toFixed(3)}:${word.text}`, word])).values()]
    .sort((a, b) => a.start - b.start);
}

export function reelCaptionFailures(timeline: Timeline, assets: Parameters<typeof retainedSpeechWords>[1]) {
  if (!timeline.clips.some(clip => clip.kind === 'caption')) return [];
  const words = retainedSpeechWords(timeline, assets);
  return words.length ? captionSyncFailures(timeline, words) : ['No retained speech transcript is available to verify caption synchronization.'];
}

/** Failed finish work is reusable only while the actual timeline, revision and evidence stay identical. */
export async function reelFinishKey(input: {
  fingerprint: string;
  revision: number;
  evidence: LaneEvidence[];
  timelines: { timelineId: string; fingerprint: string | null }[];
  assets: Parameters<typeof retainedSpeechWords>[1];
}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...input, assets: input.assets.map(asset => ({
    id: asset._id, kind: asset.kind, duration: asset.duration, audioAssetId: asset.audioAssetId, transcript: asset.analysis?.transcript,
  })) }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Match caption text and phrase edges to retained measured words, including retiming. */
export function captionSyncFailures(
  timeline: import('../../../editor/types').Timeline,
  words: { text: string; start: number; end: number }[],
  options: { checkCoverage?: boolean } = {},
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
        `Caption ${caption.id} does not match its spoken words and timing. Measured phrase: ${JSON.stringify(spoken.map(word => word.text).join(' '))}.`,
      );
      continue;
    }
    indices.forEach((index) => matched.add(index));
  }
  if (options.checkCoverage !== false && matched.size < words.length)
    failures.push(
      `${words.length - matched.size} spoken words lack synchronized captions.`,
    );
  return failures;
}
