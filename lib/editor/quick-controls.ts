import { refineTranscriptWithAudioActivity } from '../media-analysis/audio-activity';
import { readTranscript } from '../media-analysis/transcript';
import { applyMirrorBlurLayout, foldMirrorBlurStacks, stackedMirrorCopies, stackedMirrorCopyIds } from './mirror-blur-layout';
import { patchClip, placeOnFreeLayer } from './operations';
import { playbackRateOf } from './playback-rate';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import { captionClipsFromTranscript } from './transcript-captions';
import { DEFAULT_TRANSFORM, dimensions, timelineDuration, type Clip, type MediaAsset, type Timeline } from './types';

/**
 * The three one-click controls above the preview: subtitles on/off, blur background or tight crop,
 * and a hook line. Each returns the next timeline for the editor's normal change path, so it is
 * saved, shown live and undone like any other edit.
 */

// Subtitles. Captions have no hidden state, so "off" removes them and "on" puts back the ones the undo
// history still holds, or regenerates them from the saved transcript in the look they had.

const isCaption = (clip: Clip) => clip.kind === 'caption';
/** The cut the captions were timed against: when it is unchanged, saved captions still fit. */
const cutKey = (timeline: Timeline) => JSON.stringify(timeline.clips.filter(clip => clip.kind === 'video' || clip.kind === 'audio')
  .map(clip => [clip.id, clip.assetId, clip.start, clip.duration, clip.sourceStart, playbackRateOf(clip), clip.speedRamp ?? null]).sort());
/** Captions of the newest undo snapshot that has any. */
function lastCaptions(history: readonly Timeline[]) {
  for (let index = history.length - 1; index >= 0; index--) {
    const captions = history[index].clips.filter(isCaption);
    if (captions.length) return { captions, sameCut: (timeline: Timeline) => cutKey(history[index]) === cutKey(timeline) };
  }
  return undefined;
}
const hasTranscript = (asset: MediaAsset) => !!asset.analysis?.transcript || !!asset.analysisKinds?.includes('transcribe');
/** Sources whose speech is on the timeline: every video, and audio that is not a video's own sound. */
export function spokenAssetIds(timeline: Timeline, assets: readonly MediaAsset[]): string[] {
  const known = new Map(assets.map(asset => [asset._id, asset]));
  const used = timeline.clips.filter(clip => clip.kind === 'video' || (clip.kind === 'audio' && !clip.linkedClipId)).flatMap(clip => clip.assetId ?? []);
  return [...new Set(used)].filter(id => { const asset = known.get(id); return !!asset && hasTranscript(asset); });
}
export type SubtitleState = { on: boolean; disabled?: string };
export function subtitleState(timeline: Timeline, assets: readonly MediaAsset[], history: readonly Timeline[]): SubtitleState {
  if (timeline.clips.some(isCaption)) return { on: true };
  if (lastCaptions(history)?.sameCut(timeline) || spokenAssetIds(timeline, assets).length) return { on: false };
  return { on: false, disabled: 'No transcript for this footage yet' };
}
export function removeSubtitles(timeline: Timeline): Timeline {
  return { ...timeline, clips: timeline.clips.filter(clip => !isCaption(clip)) };
}
/** The captions that were turned off, exactly as they were, while the cut they were timed against is unchanged. */
export function savedSubtitles(timeline: Timeline, history: readonly Timeline[]): Timeline | undefined {
  const saved = lastCaptions(history);
  if (!saved?.sameCut(timeline)) return undefined;
  const present = new Set(timeline.clips.map(clip => clip.id));
  return saved.captions.filter(clip => !present.has(clip.id)).reduce(placeOnFreeLayer, timeline);
}
/** A caption's look without its words or timing. */
function captionLook(sample: Clip): Partial<Clip> {
  const { fontSize, fontFamily, color, background, x, y, blendMode, textStyle, textGradient, transform, animation } = sample;
  return Object.fromEntries(Object.entries({ fontSize, fontFamily, color, background, x, y, blendMode, textStyle, textGradient, transform, animation }).filter(([, value]) => value !== undefined));
}
/**
 * New captions from the saved transcripts, as addSubtitlesFromTranscript makes them. `sources` are the
 * spoken assets with their analysis loaded. Captions the undo history still holds lend their look.
 */
export function subtitlesFromTranscripts(timeline: Timeline, sources: readonly MediaAsset[], history: readonly Timeline[], createId: () => string): Timeline {
  const sample = lastCaptions(history)?.captions[0], karaoke = sample?.textTemplate?.preset === 'karaoke' ? sample.textTemplate : undefined;
  const look = sample ? captionLook(sample) : {};
  // Blurred copies from the old stacked layout repeat their sharp clip's footage; caption the speech once.
  const copies = stackedMirrorCopyIds(timeline);
  const captions = sources.flatMap(asset => {
    // A loaded asset carries its transcript in transport form (long word lists arrive in chunks).
    const raw = asset.analysis?.transcript && readTranscript(asset.analysis.transcript);
    if (!raw || (!raw.words.length && !raw.segments.length)) return [];
    const transcript = asset.analysis?.audioActivity ? refineTranscriptWithAudioActivity(raw, asset.analysis.audioActivity) : raw;
    return timeline.clips.filter(clip => clip.assetId === asset._id && !copies.has(clip.id)).flatMap(clip => captionClipsFromTranscript(clip, transcript, timeline.fps, createId, karaoke ? 'clipper' : 'minimal'));
  }).map(clip => ({
    ...clip, ...look,
    ...(karaoke && clip.textTemplate ? { textTemplate: { ...clip.textTemplate, highlightColor: karaoke.highlightColor, karaokeStyle: karaoke.karaokeStyle } } : {}),
  }));
  if (!captions.length) throw new Error('No speech was found in this footage, so there is nothing to caption.');
  return captions.reduce(placeOnFreeLayer, timeline);
}

// Layout. Both are settings on each video clip; nothing is added to the timeline.

export type QuickLayout = 'blur' | 'crop';
export type LayoutState = { value: QuickLayout | 'mixed' | null; disabled?: string };
/** Video clips whose source is wider than a vertical frame. */
function layoutClips(timeline: Timeline, assets: readonly MediaAsset[]): Clip[] {
  const canvas = dimensions(timeline.aspectRatio);
  if (canvas.height <= canvas.width) return [];
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  const copies = stackedMirrorCopyIds(timeline);
  return timeline.clips.filter(clip => {
    const asset = clip.kind === 'video' ? sources.get(clip.assetId ?? '') : undefined;
    return !!asset?.width && !!asset.height && asset.width / asset.height > canvas.width / canvas.height + 1e-6 && !copies.has(clip.id);
  });
}
const layoutOf = (clip: Clip): QuickLayout | null => clip.backgroundFill?.kind === 'mirror-blur' ? 'blur' : (clip.fit ?? 'cover') === 'cover' ? 'crop' : null;
export function layoutState(timeline: Timeline, assets: readonly MediaAsset[]): LayoutState {
  const clips = layoutClips(timeline, assets);
  if (!clips.length) return { value: null, disabled: 'For landscape footage on a vertical timeline' };
  const layouts = new Set(clips.map(layoutOf));
  return { value: layouts.size > 1 ? 'mixed' : [...layouts][0] };
}
const isCentredCover = (clip: Clip) => layoutOf(clip) === 'crop' && !clip.crop && !clip.flip && JSON.stringify({ ...DEFAULT_TRANSFORM, ...clip.transform, opacity: 1 }) === JSON.stringify(DEFAULT_TRANSFORM);
/** blur: the full-width picture over its own mirrored, blurred frames. crop: the picture fills the frame, centred. */
export function applyQuickLayout(timeline: Timeline, assets: readonly MediaAsset[], layout: QuickLayout): Timeline {
  const ids = layoutClips(timeline, assets).map(clip => clip.id);
  if (!ids.length) return timeline;
  // A subject-follow crop, smooth zoom and camera move frame a filled picture; the full-width layout refuses them, so they go.
  if (layout === 'blur') return applyMirrorBlurLayout(ids.reduce((next, id) => patchClip(next, id, { focus: undefined, framingCuts: undefined, smoothZoom: undefined, cameraMotion: undefined }), timeline), assets, ids).timeline;
  // Blurred copies from the old stacked layout would stay hidden beneath a filled picture: fold them away first.
  const stacked = ids.filter(id => stackedMirrorCopies(timeline, id).length);
  const folded = stacked.length ? foldMirrorBlurStacks(timeline, stacked).timeline : timeline;
  return ids.reduce((next, id) => {
    const clip = next.clips.find(current => current.id === id)!;
    // A clip that already fills the frame, centred, keeps its follow crop and zooms untouched.
    if (isCentredCover(clip)) return next;
    return patchClip(next, id, { fit: 'cover', crop: undefined, flip: undefined, backgroundFill: undefined, transform: { ...DEFAULT_TRANSFORM, opacity: clip.transform?.opacity ?? 1 } });
  }, folded);
}

// Hook. One title the control owns, found again by its id; other text clips are never touched.

export const HOOK_CLIP_ID = 'hook-title';
export const HOOK_SECONDS = 4;
export const HOOK_MAX_LENGTH = 120;
const HOOK_STYLE = {
  fontSize: 76, color: '#FFFFFF', background: 'transparent', x: .5, y: .17, animation: 'none',
  textStyle: { ...DEFAULT_TEXT_APPEARANCE, fontWeight: 700, strokeWidth: 10, shadowBlur: 6, shadowY: 3, shadowColor: '#00000099' },
} as const;
const hookClip = (timeline: Timeline) => timeline.clips.find(clip => clip.id === HOOK_CLIP_ID && clip.kind === 'graphic');
export const hookText = (timeline: Timeline) => hookClip(timeline)?.text ?? '';
/** Create, reword or (with an empty line) remove the hook title: static, from the first frame. */
export function setHook(timeline: Timeline, text: string): Timeline {
  const line = text.trim().slice(0, HOOK_MAX_LENGTH), existing = hookClip(timeline);
  if (!line) return existing ? { ...timeline, clips: timeline.clips.filter(clip => clip !== existing) } : timeline;
  if (existing) return existing.text === line ? timeline : patchClip(timeline, existing.id, { text: line });
  if (timeline.clips.some(clip => clip.id === HOOK_CLIP_ID)) throw new Error('Another clip already uses the hook title’s place. Remove it first.');
  const length = timelineDuration(timeline);
  return placeOnFreeLayer(timeline, { id: HOOK_CLIP_ID, kind: 'graphic', start: 0, duration: length > 0 ? Math.min(HOOK_SECONDS, length) : HOOK_SECONDS, sourceStart: 0, text: line, ...HOOK_STYLE });
}
