import { TimelineGestureRejection } from './timeline-edit-errors';
import { Clip, Timeline, timelineDuration, layerGroup, trackOf, deriveTrackCounts, normalizeTimeline, maxTrackCount } from './types';
export function snapTime(time: number, fps: number) { return Math.round(Math.max(0, time) * fps) / fps; }
export function linkedClipIds(timeline: Timeline, ids: string[]): string[] {
  const selected = new Set(ids);
  for (const clip of timeline.clips) if (selected.has(clip.id) && clip.linkedClipId) selected.add(clip.linkedClipId);
  return [...selected];
}
export function unlinkClips(timeline: Timeline, id: string): Timeline {
  const ids = new Set(linkedClipIds(timeline, [id]));
  return { ...timeline, clips: timeline.clips.map(clip => ids.has(clip.id) ? { ...clip, linkedClipId: undefined } : clip) };
}
/** Seek to a frame without clamping back to an imported, fractional endpoint. */
export function frameSeekTime(time: number, fps: number, duration: number) {
  if (![time, fps, duration].every(Number.isFinite) || fps <= 0 || duration <= 0) return 0;
  // Match the composition clock's seven-decimal precision at exact frame ends.
  const lastFrame = Math.floor((duration + 1e-7) * fps);
  if (!Number.isFinite(lastFrame)) return 0;
  const frame = Math.min(lastFrame, Math.round(Math.max(0, Math.min(time, duration)) * fps));
  return frame / fps;
}
export function splitClip(timeline: Timeline, clipId: string, time: number, newId: string): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === clipId);
  const reject = () => { throw new TimelineGestureRejection('Place the playhead inside the selected clip to split it.'); };
  if (!clip || ![time, timeline.fps, clip.start, clip.duration, clip.sourceStart, clip.start + clip.duration].every(Number.isFinite)
    || timeline.fps <= 0 || clip.start < 0 || clip.sourceStart < 0 || time <= clip.start || time >= clip.start + clip.duration) return reject();
  const frame = 1 / timeline.fps;
  let offset = snapTime(time - clip.start, timeline.fps);
  let tail = clip.duration - offset;
  // Absorb subtraction round-off at one frame, while rejecting genuinely shorter fragments.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(clip.duration), Math.abs(offset)) * 8;
  if (offset < frame - roundoff || tail < frame - roundoff) return reject();
  if (Math.abs(tail - frame) <= roundoff) { tail = frame; offset = clip.duration - tail; }
  if (Math.abs(offset - frame) <= roundoff) offset = frame;
  const pair = timeline.clips.find(c => c.id === clip.linkedClipId && c.linkedClipId === clip.id);
  const pairId = `${newId}-audio`;
  return { ...timeline, clips: timeline.clips.flatMap(c => c.id !== clipId && c.id !== pair?.id ? [c] : [
    { ...c, duration: offset },
    { ...c, id: c.id === clipId ? newId : pairId, linkedClipId: pair ? c.id === clipId ? pairId : newId : undefined, start: c.start + offset, sourceStart: c.sourceStart + offset, duration: tail },
  ]) };
}
export function patchClip(timeline: Timeline, id: string, patch: Partial<Clip>): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === id);
  if (!clip) return timeline;
  const timing: Partial<Clip> = {};
  for (const key of ['start', 'duration', 'sourceStart'] as const) if (patch[key] !== undefined) timing[key] = patch[key];
  const volumeTarget = clip.kind === 'video' && clip.linkedClipId ? clip.linkedClipId : id;
  return { ...timeline, clips: timeline.clips.map(c => {
    let next = c.id === id ? { ...c, ...patch, id: c.id } : c.id === clip.linkedClipId ? { ...c, ...timing } : c;
    if (patch.volume !== undefined && c.id === volumeTarget) next = { ...next, volume: patch.volume };
    if (next.kind === 'video' && next.audioSeparated) next = { ...next, volume: 0 };
    return next;
  }) };
}
export function deleteClip(timeline: Timeline, id: string): Timeline { timeline = normalizeTimeline(timeline); const ids = new Set(linkedClipIds(timeline, [id])); return { ...timeline, clips: timeline.clips.filter(c => !ids.has(c.id)) }; }
export function duplicateClip(timeline: Timeline, id: string, newId: string): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === id);
  if (!clip) return timeline;
  const pair = timeline.clips.find(c => c.id === clip.linkedClipId && c.linkedClipId === clip.id);
  const pairId = `${newId}-audio`;
  let next = placeOnFreeLayer(timeline, { ...clip, id: newId, linkedClipId: pair ? pairId : undefined, start: clip.start + clip.duration });
  if (pair) next = placeOnFreeLayer(next, { ...pair, id: pairId, linkedClipId: newId, start: pair.start + clip.duration });
  return next;
}
export function addMediaClip(timeline: Timeline, asset: { _id: string; kind: Clip['kind']; duration?: number; audioAssetId?: string }, id: string, at?: number, track = 1): Timeline {
  timeline = normalizeTimeline(timeline);
  const group = layerGroup(asset.kind);
  const trackEnd = Math.max(0, ...timeline.clips.filter(c => layerGroup(c.kind) === group && trackOf(c) === track).map(c => c.start + c.duration));
  const next = placeOnFreeLayer(timeline, { id, kind: asset.kind, assetId: asset._id, track, start: at ?? trackEnd, duration: asset.kind === 'image' ? 5 : asset.duration || 5, sourceStart: 0, volume: 1 });
  return separateVideoClips(next, asset);
}
/** Preserve existing cuts and levels when giving a video's sound its own clip. */
export function separateVideoClips(timeline: Timeline, asset: { _id: string; audioAssetId?: string }): Timeline {
  if (!asset.audioAssetId) return timeline;
  let next = timeline;
  for (const clip of timeline.clips) {
    if (clip.kind !== 'video' || clip.assetId !== asset._id || clip.audioSeparated) continue;
    const audioId = `${clip.id}-audio`;
    next = placeOnFreeLayer(next, { id: audioId, kind: 'audio', assetId: asset.audioAssetId, track: 1, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, volume: clip.volume ?? 1, linkedClipId: clip.id });
    next = { ...next, clips: next.clips.map(c => c.id === clip.id ? { ...c, volume: 0, audioSeparated: true, linkedClipId: audioId } : c) };
  }
  return next;
}
export function addTextClip(timeline: Timeline, id: string, kind: 'caption' | 'graphic', at: number): Timeline {
  timeline = normalizeTimeline(timeline);
  return placeOnFreeLayer(timeline, { id, kind, start: at, duration: Math.min(3, Math.max(1, timelineDuration(timeline) - at)), sourceStart: 0, text: kind === 'caption' ? 'Your words here.' : 'MAKE ROOM FOR YOUR NEXT IDEA.', fontSize: kind === 'caption' ? 52 : 92, color: '#F4F4F0', background: kind === 'caption' ? '#0B0C0E' : 'transparent', x: 0.5, y: kind === 'caption' ? 0.82 : 0.55, animation: 'none' });
}
/** Keep overlapping clips separate; an existing ID moves rather than duplicates. */
export function placeOnFreeLayer(timeline: Timeline, clip: Clip): Timeline {
  timeline = normalizeTimeline(timeline);
  const previous = timeline.clips.find(current => current.id === clip.id);
  if (previous?.linkedClipId) timeline = patchClip(timeline, clip.id, { start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart });
  if (clip.kind === 'video' && clip.audioSeparated) clip = { ...clip, volume: 0 };
  const group = layerGroup(clip.kind);
  let track = trackOf(clip);
  if (clip.track === undefined && (clip.kind === 'caption' || clip.kind === 'graphic')) {
    const beneath = timeline.clips.filter(other => other.id !== clip.id && layerGroup(other.kind) === 'visual'
      && other.start < clip.start + clip.duration - 0.000001 && clip.start < other.start + other.duration - 0.000001);
    track = Math.max(0, ...beneath.map(trackOf)) + 1;
  }
  const overlaps = (other: Clip) => other.id !== clip.id && layerGroup(other.kind) === group && trackOf(other) === track && other.start < clip.start + clip.duration - 0.000001 && clip.start < other.start + other.duration - 0.000001;
  const maximum = maxTrackCount(group);
  while (track <= maximum && timeline.clips.some(overlaps)) track++;
  if (track > maximum) throw new Error(`All ${maximum} layers overlap here. Move the clip to another time or remove a layer.`);
  const placed = { ...clip, track };
  const clips = timeline.clips.some(current => current.id === clip.id) ? timeline.clips.map(current => current.id === clip.id ? placed : current) : [...timeline.clips, placed];
  const next = { ...timeline, clips };
  return { ...next, tracks: deriveTrackCounts(next) };
}
/** Keep only source samples needed to interpolate this trimmed clip's crop. */
export function focusForClip(focus:NonNullable<Clip['focus']>,clip:Clip):NonNullable<Clip['focus']> {
  const start=clip.sourceStart;const end=start+clip.duration;const before=focus.filter(s=>s.time<start).at(-1);const after=focus.find(s=>s.time>end);
  return [...(before?[before]:[]),...focus.filter(s=>s.time>=start&&s.time<=end),...(after?[after]:[])];
}
