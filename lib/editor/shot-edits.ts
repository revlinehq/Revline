import { anchoredFadeTimingPatch } from './fade-clock';
import { ownClockTimingPatch } from './clip-effects';
import { isTransitionClip, reconcileTransitionEdits } from './clip-transitions';
import { mirrorFillOwner, stackedMirrorCopies, stackedMirrorCopyIds } from './mirror-blur-layout';
import { deleteClip, linkedClipIds } from './operations';
import { playbackRateOf } from './playback-rate';
import { deriveTrackCounts, layerGroup, normalizeTimeline, trackOf, type Clip, type MediaAsset, type Timeline } from './types';

/**
 * Montage shot edits: a "shot" is one footage clip with everything that plays only for it, its
 * linked audio and, on timelines made before backgroundFill, the stacked mirror-blur copies beneath
 * it. Each edit here is one timeline change, so one tool call and one saved revision.
 */

const EPSILON = 1e-6;
const footage = (clip: Clip) => clip.kind === 'video' || clip.kind === 'image';
const lane = (clip: Clip) => `${layerGroup(clip.kind)}:${trackOf(clip)}`;
const round = (value: number) => Math.round(value * 1000) / 1000;


/** The footage layer a montage is cut on: the V layer holding the most footage time, ignoring mirror copies. */
function primaryTrack(timeline: Timeline, copies: ReadonlySet<string>) {
  const totals = new Map<number, number>();
  for (const clip of timeline.clips) if (footage(clip) && !copies.has(clip.id)) totals.set(trackOf(clip), (totals.get(trackOf(clip)) ?? 0) + clip.duration);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** The V layer the edit is cut on: the one holding the most footage time. Undefined on a timeline without footage. */
export function mainFootageTrack(input: Timeline) { const timeline = normalizeTimeline(input); return primaryTrack(timeline, stackedMirrorCopyIds(timeline)); }

/** Whether a clip is footage on the layer the edit is cut on: where a trim or delete closes up by default. */
export function onMainFootageTrack(input: Timeline, clipId: string) {
  const timeline = normalizeTimeline(input), copies = stackedMirrorCopyIds(timeline);
  const clip = timeline.clips.find(item => item.id === clipId), video = clip?.kind === 'audio' && clip.linkedClipId ? timeline.clips.find(item => item.id === clip.linkedClipId) : clip;
  return !!video && footage(video) && trackOf(video) === primaryTrack(timeline, copies);
}

/**
 * Close up after a clip got shorter: clips that started at or after its old end on its layer move earlier by
 * `seconds`, with their linked partners. Other layers (music, captions, overlays) keep their times. Returns
 * undefined when the moved clips would collide, so the caller keeps the plain trim.
 */
export function rippleAfter(input: Timeline, clipId: string, oldEnd: number, seconds: number): { timeline: Timeline; shifted: number } | undefined {
  const timeline = normalizeTimeline(input), clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || seconds <= EPSILON) return undefined;
  const byId = new Map(timeline.clips.map(item => [item.id, item])), own = new Set(linkedClipIds(timeline, [clipId]));
  const shifts = new Set<string>();
  for (const other of timeline.clips) {
    if (own.has(other.id) || isTransitionClip(other) || lane(other) !== lane(clip) || other.start < oldEnd - EPSILON) continue;
    shifts.add(other.id);
    const partner = other.linkedClipId ? byId.get(other.linkedClipId) : undefined;
    if (partner && partner.linkedClipId === other.id) shifts.add(partner.id);
  }
  if (!shifts.size) return undefined;
  const moved = { ...timeline, clips: timeline.clips.map(item => shifts.has(item.id) ? { ...item, start: Math.max(0, item.start - seconds) } : item) };
  const collides = moved.clips.some(item => shifts.has(item.id) && moved.clips.some(other => other.id !== item.id && !isTransitionClip(other) && lane(other) === lane(item)
    && other.start < item.start + item.duration - EPSILON && item.start < other.start + other.duration - EPSILON));
  if (collides) return undefined;
  const result = reconcileTransitionEdits(timeline, moved);
  return { timeline: { ...result, tracks: deriveTrackCounts(result) }, shifted: shifts.size };
}

/**
 * The shot playing at a timeline second: the footage clip showing at that time (a clip owns its start,
 * not its end). With several stacked footage clips, the one on `track`, else on the main footage layer,
 * else the topmost. Mirror-blur copies are never chosen.
 */
export function shotAt(input: Timeline, time: number, track?: number): Clip {
  const timeline = normalizeTimeline(input);
  if (!Number.isFinite(time) || time < 0) throw new Error('Choose a timeline time in seconds.');
  const copies = stackedMirrorCopyIds(timeline);
  const showing = timeline.clips.filter(clip => footage(clip) && !copies.has(clip.id) && !mirrorFillOwner(clip.id) && clip.start <= time + EPSILON && time < clip.start + clip.duration - EPSILON);
  const onTrack = track === undefined ? showing : showing.filter(clip => trackOf(clip) === track);
  if (!onTrack.length) throw new Error(`No video or image clip is showing at ${round(time)} s${track === undefined ? '' : ` on V${track}`}. Read clip times with inspectTimeline.`);
  if (onTrack.length === 1) return onTrack[0];
  const main = primaryTrack(timeline, copies);
  return onTrack.find(clip => trackOf(clip) === main) ?? [...onTrack].sort((a, b) => trackOf(b) - trackOf(a))[0];
}

/** A shot's clips: the clip, its linked partner and any stacked mirror-blur copies of it. */
export function shotMembers(timeline: Timeline, id: string): Clip[] {
  const ids = new Set(linkedClipIds(timeline, [id]));
  for (const copy of stackedMirrorCopies(timeline, id)) ids.add(copy.id);
  return timeline.clips.filter(clip => ids.has(clip.id));
}

export type ShotSummary = { clipId: string; start: number; end: number; track: number; sourceStart?: number };
const summary = (clip: Clip): ShotSummary => ({ clipId: clip.id, start: round(clip.start), end: round(clip.start + clip.duration), track: trackOf(clip), ...(clip.kind === 'video' || clip.kind === 'audio' ? { sourceStart: round(clip.sourceStart) } : {}) });

/**
 * Delete shots with their linked audio and stacked mirror copies. With ripple, later clips on each
 * layer a removed clip occupied move earlier by the removed time, with their linked partners, so the
 * montage closes up; other layers (music, captions) keep their times.
 */
export function removeShots(input: Timeline, ids: readonly string[], ripple: boolean): { timeline: Timeline; removedClipIds: string[]; shifted: number } {
  const timeline = normalizeTimeline(input);
  const removed = new Set<string>();
  for (const id of ids) {
    if (!timeline.clips.some(clip => clip.id === id)) throw new Error('Clip not found');
    for (const member of shotMembers(timeline, id)) removed.add(member.id);
  }
  let next = timeline;
  for (const id of removed) if (next.clips.some(clip => clip.id === id)) next = deleteClip(next, id);
  // deleteClip also drops the linked partners it finds; report everything that left the timeline.
  const removedClipIds = timeline.clips.filter(clip => !next.clips.some(other => other.id === clip.id)).map(clip => clip.id);
  if (!ripple) return { timeline: next, removedClipIds, shifted: 0 };
  const gone = timeline.clips.filter(clip => removedClipIds.includes(clip.id) && !isTransitionClip(clip));
  const shiftOf = (clip: Clip) => gone.filter(other => lane(other) === lane(clip) && other.start + other.duration <= clip.start + EPSILON).reduce((sum, other) => sum + other.duration, 0);
  const shifts = new Map<string, number>();
  for (const clip of next.clips) if (!isTransitionClip(clip)) { const shift = shiftOf(clip); if (shift > EPSILON) shifts.set(clip.id, shift); }
  // A linked pair moves as one: the picture's shift wins, so sound never drifts from its video.
  const byId = new Map(next.clips.map(clip => [clip.id, clip]));
  for (const clip of next.clips) {
    const partner = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    if (!partner || layerGroup(clip.kind) !== 'visual') continue;
    const shift = shifts.get(clip.id) ?? 0;
    if (shift > EPSILON) shifts.set(partner.id, shift); else shifts.delete(partner.id);
  }
  if (!shifts.size) return { timeline: next, removedClipIds, shifted: 0 };
  const moved = { ...next, clips: next.clips.map(clip => shifts.has(clip.id) ? { ...clip, start: Math.max(0, clip.start - shifts.get(clip.id)!) } : clip) };
  const result = reconcileTransitionEdits(next, moved);
  return { timeline: { ...result, tracks: deriveTrackCounts(result) }, removedClipIds, shifted: shifts.size };
}

/**
 * Two shots trade timeline slots. Each slot keeps its start, duration and layer; the incoming shot
 * keeps its own footage from its source start, moved earlier only when the footage would run out.
 * Linked audio and stacked mirror copies travel with their shot.
 */
export function swapShots(input: Timeline, assets: readonly Pick<MediaAsset, '_id' | 'kind' | 'duration'>[], aId: string, bId: string): { timeline: Timeline; a: ShotSummary; b: ShotSummary } {
  const timeline = normalizeTimeline(input);
  const find = (id: string) => { const clip = timeline.clips.find(item => item.id === id); if (!clip) throw new Error('Clip not found'); return clip; };
  const a = find(aId), b = find(bId);
  for (const clip of [a, b]) if (!footage(clip)) throw new Error('Choose two video or image shots to swap. Audio follows its linked video.');
  const membersA = shotMembers(timeline, a.id), membersB = shotMembers(timeline, b.id);
  if (a.id === b.id || membersA.some(member => membersB.some(other => other.id === member.id))) throw new Error('Choose two different shots to swap.');
  const members = new Set([...membersA, ...membersB].map(clip => clip.id));
  if (timeline.clips.some(clip => isTransitionClip(clip) && clip.transition && (members.has(clip.transition.fromClipId) || members.has(clip.transition.toClipId)))) throw new Error('A transition joins one of these shots. Delete the transition first, swap, then add it again.');
  if ([...membersA, ...membersB].some(clip => clip.speedRamp?.length)) throw new Error('A speed-ramped shot cannot take another slot length. Remove the ramp first.');
  const sources = new Map(assets.map(asset => [asset._id, asset]));
  const frame = 1 / timeline.fps;
  const place = (primary: Clip, group: Clip[], slot: Clip) => {
    const rate = playbackRateOf(primary), need = slot.duration * rate;
    const timed = primary.kind === 'video';
    const available = timed ? sources.get(primary.assetId ?? '')?.duration : undefined;
    let sourceStart = primary.sourceStart;
    if (timed && available !== undefined && sourceStart + need > available + EPSILON) {
      if (available + EPSILON < need) throw new Error(`Shot ${primary.id} has ${round(available)} s of footage at its speed but the slot at ${round(slot.start)} s needs ${round(need)} s. Trim the slot first, or swap a longer shot.`);
      sourceStart = Math.max(0, available - need);
    }
    const shift = sourceStart - primary.sourceStart, layerShift = trackOf(slot) - trackOf(primary);
    return group.map(member => {
      const start = slot.start + (member.start - primary.start);
      const duration = slot.duration - (primary.duration - member.duration);
      if (duration < frame - EPSILON || start < -EPSILON) throw new Error(`Clip ${member.id} would not fit the slot at ${round(slot.start)} s.`);
      const timedMember = member.kind === 'video' || member.kind === 'audio';
      const memberSource = timedMember ? member.sourceStart + shift : member.sourceStart;
      const memberAvailable = timedMember && member.id !== primary.id ? sources.get(member.assetId ?? '')?.duration : undefined;
      if (memberSource < -EPSILON || memberAvailable !== undefined && memberSource + duration * playbackRateOf(member) > memberAvailable + EPSILON) throw new Error(`The linked audio of shot ${primary.id} has too little source for the slot at ${round(slot.start)} s.`);
      return { ...member, ...ownClockTimingPatch(member), ...anchoredFadeTimingPatch(member, { start, duration }), start, duration, sourceStart: Math.max(0, memberSource), track: layerGroup(member.kind) === layerGroup(primary.kind) ? trackOf(member) + layerShift : trackOf(member) };
    });
  };
  const placed = new Map([...place(b, membersB, a), ...place(a, membersA, b)].map(clip => [clip.id, clip]));
  const swapped = { ...timeline, clips: timeline.clips.map(clip => placed.get(clip.id) ?? clip) };
  const result = reconcileTransitionEdits(timeline, swapped);
  return { timeline: { ...result, tracks: deriveTrackCounts(result) }, a: summary(placed.get(a.id)!), b: summary(placed.get(b.id)!) };
}
