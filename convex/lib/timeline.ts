import { validateColorFinish, validateTimelineLuts } from '../../lib/editor/color-finish';
import { validateVisualTransform } from '../../lib/editor/visual-inputs';
import { historyTimelines, writeProject, type HistoryEntry } from './project_data';
import type { RevisionNote } from './revision_log';
import { validateClipEffects } from '../../lib/editor/clip-effects';
import { playbackRateOf, sourceEndOf } from '../../lib/editor/playback-rate';
import { transitionSources } from '../../lib/editor/clip-transitions';
import { validateVisualFade } from '../../lib/editor/visual-fades';
import { validateAudioTimeline } from '../../lib/editor/audio-settings';
import { ConvexError } from "convex/values";
import { layerGroup, maxTrackCount, normalizeTimeline, trackOf, type Timeline } from "../../lib/editor/types";
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { newLayerOverlaps } from '../../lib/editor/operations';
import { TIMELINE_CONFLICT } from '../../lib/editor/timeline-sync';
import { runFailure } from '../../lib/ai/run-failure';
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Stored rows carry a current-version fingerprint; others fall back to hashing. */
async function historyKeys(ctx: MutationCtx, entries: HistoryEntry[]) {
  const loaded = entries.every(entry => entry.key || entry.timeline) ? entries : await historyTimelines(ctx, entries);
  return Promise.all(loaded.map(entry => entry.key ?? timelineHistoryKey(entry.timeline!)));
}
/** The largest timeline a save accepts, in bytes of JSON. Every path that sends a whole timeline uses this one limit. */
export const TIMELINE_BYTE_LIMIT = 300_000;
export function currentTimeline(project: Doc<"projects">): Timeline {
  return normalizeTimeline(project.timeline ?? { clips: [], fps: 60, aspectRatio: project.aspectRatio });
}
export function validateFocus(focus: { time: number; x: number; y: number }[], duration = 86400) {
  if (focus.length > 1500 || focus.some((sample, i) => !Number.isFinite(sample.time) || sample.time < 0 || sample.time > duration + 0.5 || !Number.isFinite(sample.x) || !Number.isFinite(sample.y) || sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1 || (i > 0 && sample.time <= focus[i - 1].time))) throw new ConvexError("Invalid subject tracking samples");
}
export async function validateTimeline(ctx: MutationCtx | QueryCtx, project: Doc<"projects">, timeline: Timeline) {
  // Scene code is stored by hash, so the record limit counts it as one.
  const bytes = new TextEncoder().encode(JSON.stringify(timeline)).byteLength;
  // Say what filled it: captions are the usual cause on a long talk, and "shorten text" alone gave the agent nothing to act on.
  if (bytes > TIMELINE_BYTE_LIMIT) throw new ConvexError(`Timeline is too large to save: ${Math.round(bytes / 1000)} KB of ${TIMELINE_BYTE_LIMIT / 1000} KB, with ${timeline.clips.length} clips (${timeline.clips.filter(clip => clip.kind === 'caption').length} captions). Use fewer, longer captions, shorten text, or reduce subject tracking samples.`);
  if (![24, 30, 60].includes(timeline.fps)) throw new ConvexError("Choose 24, 30, or 60 fps");
  const markerIds = new Set<string>();
  for (const marker of timeline.markers ?? []) {
    if (!marker.id || marker.id.length > 100 || markerIds.has(marker.id)) throw new ConvexError('Marker IDs must be unique and nonempty');
    if (!Number.isFinite(marker.time) || marker.time < 0) throw new ConvexError('Marker time must be finite and nonnegative');
    if ((marker.label?.length ?? 0) > 120) throw new ConvexError('Marker labels support up to 120 characters');
    if (marker.kind !== undefined && marker.kind !== 'section') throw new ConvexError('Marker kind must be section or omitted');
    markerIds.add(marker.id);
  }
  // Validate the input before conversion so inferred counts cannot repair an
  // out-of-range clip or a clip outside its declared legacy group.
  const canonical = timeline.tracks?.overlay === 0;
  if (timeline.tracks) {
    const { visual, overlay, audio, effects } = timeline.tracks;
    if (![visual, overlay, audio].every(Number.isInteger) || audio < 0 || audio > 12 || (canonical ? visual < 0 || visual > 24 : visual < 0 || visual > 12 || overlay < 0 || overlay > 12) || (effects !== undefined && (!Number.isInteger(effects) || effects < 0 || effects > 24))) throw new ConvexError("Use 0–24 visual/effects tracks and 0–12 audio tracks");
  }
  for (const clip of timeline.clips) {
    const track = clip.track ?? (clip.kind === "caption" ? 2 : 1);
    const group = clip.kind === 'effect' ? 'effects' : canonical ? layerGroup(clip.kind) : clip.kind === "caption" || clip.kind === "graphic" ? "overlay" : clip.kind === "audio" ? "audio" : "visual";
    const limit = group === 'effects' || canonical ? maxTrackCount(group) : 12;
    if (!Number.isInteger(track) || track < 1 || track > limit) throw new ConvexError(`Clip tracks must be integers between 1 and ${limit}`);
    const declaredCount = timeline.tracks?.[group];
    if (declaredCount !== undefined && track > declaredCount) throw new ConvexError("Clip layer exceeds the declared layer count");
  }
  try { validateTimelineLuts(timeline.luts); for (const clip of timeline.clips) validateColorFinish(clip, timeline.luts ?? []); } catch (error) { throw new ConvexError((error as Error).message); }
  timeline = normalizeTimeline(timeline);
  const ids = new Set<string>();
  const clipsById = new Map(timeline.clips.map(clip => [clip.id, clip]));
  for (const clip of timeline.clips) {
    if (!clip.id || clip.id.length > 100 || ids.has(clip.id)) throw new ConvexError("Clip IDs must be unique and nonempty");
    ids.add(clip.id);
    try { validateClipEffects(clip); validateVisualFade(clip); } catch (error) { throw new ConvexError((error as Error).message); }
    if (![clip.start, clip.duration, clip.sourceStart, clip.start + clip.duration].every(Number.isFinite) || clip.start < 0 || clip.sourceStart < 0 || clip.duration < 1 / timeline.fps) throw new ConvexError("Clip timing must be finite, nonnegative, and at least one frame long");
    for (const key of ["x", "y"] as const) if (clip[key] !== undefined && (!Number.isFinite(clip[key]) || clip[key] < 0 || clip[key] > 1)) throw new ConvexError("Position must be between 0 and 1");
    if (clip.volume !== undefined && (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2)) throw new ConvexError("Volume must be between 0 and 2");
    if (clip.audioSeparated && (clip.kind !== 'video' || clip.volume !== 0)) throw new ConvexError('Separated video audio must remain muted');
    if (clip.linkedClipId) {
      const pair = clipsById.get(clip.linkedClipId);
      if (!pair || pair.id === clip.id || pair.linkedClipId !== clip.id || !((clip.kind === 'video' && pair.kind === 'audio') || (clip.kind === 'audio' && pair.kind === 'video'))) throw new ConvexError('Video and audio links must reference each other');
      const video = clip.kind === 'video' ? clip : pair;
      if (!video.audioSeparated || video.volume !== 0) throw new ConvexError('Linked video must use its separate audio clip');
      if (['start', 'duration', 'sourceStart'].some(key => Math.abs(clip[key as 'start'] - pair[key as 'start']) > 1e-7)) throw new ConvexError('Linked video and audio must stay synchronized');
      if (Math.abs(playbackRateOf(clip) - playbackRateOf(pair)) > 1e-7 || JSON.stringify(clip.speedRamp ?? null) !== JSON.stringify(pair.speedRamp ?? null)) throw new ConvexError('Linked video and audio must stay synchronized');
    }
    if(clip.normalizedAudio){
      const id=ctx.db.normalizeId('assets',clip.normalizedAudio.assetId),bake=id?await ctx.db.get(id):null;
      if(clip.kind!=='audio'||!bake||bake.kind!=='audio'||bake.ownerId!==project.ownerId||bake.projectId!==project._id||clip.normalizedAudio.key.length>16000||!Number.isFinite(clip.normalizedAudio.targetLufs)||!Number.isFinite(clip.normalizedAudio.truePeak)||clip.normalizedAudio.truePeak> -1||(clip.normalizedAudio.offset!==undefined&&(!Number.isFinite(clip.normalizedAudio.offset)||clip.normalizedAudio.offset<0)))throw new ConvexError('Normalized sound must belong to this project.');
    }
    const track = trackOf(clip);
    const group = layerGroup(clip.kind);
    if (track > maxTrackCount(group)) throw new ConvexError("Clip track exceeds its group limit");
    const declaredCount = timeline.tracks?.[group];
    if (declaredCount !== undefined && track > declaredCount) throw new ConvexError("Clip layer exceeds the declared layer count");
    const textClip = clip.kind === 'caption' || clip.kind === 'graphic';
    const visualMedia = clip.kind === 'video' || clip.kind === 'image';
    if ((clip.crop || clip.fit || (clip.transform && !textClip)) && !visualMedia) throw new ConvexError("Transforms, cropping, and fit apply to visual media only");
    if (clip.transform) {
      const transform = clip.transform;
      try{validateVisualTransform(transform);}catch{throw new ConvexError('Invalid visual transform');}
      if (textClip && (transform.x !== .5 || transform.y !== .5 || transform.scale !== 1 || transform.opacity !== 1)) throw new ConvexError('Text transforms support rotation only; use text position and size controls');
    }
    if (clip.crop && (Object.values(clip.crop).some(edge => !Number.isFinite(edge) || edge < 0 || edge > 0.95) || clip.crop.left + clip.crop.right >= 0.95 || clip.crop.top + clip.crop.bottom >= 0.95)) throw new ConvexError("Crop must leave at least five percent of each source axis visible");
    if (clip.fontSize !== undefined && (!Number.isFinite(clip.fontSize) || clip.fontSize < 8 || clip.fontSize > 300)) throw new ConvexError("Font size must be between 8 and 300");
    for (const value of [clip.color, clip.background]) if (value !== undefined && !/^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i.test(value)) throw new ConvexError("Colors must use a hex value or transparent");
    if ((clip.text?.length ?? 0) > 2000) throw new ConvexError("Text clips support up to 2000 characters");
    if (clip.focus && clip.kind !== "video") throw new ConvexError("Subject tracking applies to video clips only");
    if (clip.kind === 'effect' || clip.kind === 'solid' || clip.kind === 'scene') continue;
    if (clip.kind === "caption" || clip.kind === "graphic") {
      if (clip.text === undefined || clip.assetId) throw new ConvexError("Text clips need text and cannot reference media");
      continue;
    }
    const assetId = clip.assetId && ctx.db.normalizeId("assets", clip.assetId);
    const asset = assetId ? await ctx.db.get(assetId) : null;
    if (!asset || asset.ownerId !== project.ownerId || asset.projectId !== project._id || asset.kind !== clip.kind) throw new ConvexError("Clip media must belong to this project and match its kind");
    if (clip.kind === 'video' && clip.linkedClipId && asset.audioAssetId !== clipsById.get(clip.linkedClipId)?.assetId) throw new ConvexError('Linked audio must come from this video');
    if (clip.focus) { if (clip.kind !== "video") throw new ConvexError("Subject tracking applies to video clips only"); validateFocus(clip.focus, asset.duration); }
    if (asset.kind !== "image" && asset.duration !== undefined && sourceEndOf(clip) > asset.duration + 1 / timeline.fps) throw new ConvexError("Source trim extends beyond the media duration");
  }
  try { transitionSources(timeline.clips,timeline.fps); } catch(error) { throw new ConvexError((error as Error).message); }
  if(timeline.audioNormalization){
    const bake=timeline.audioNormalization,id=ctx.db.normalizeId('assets',bake.assetId),asset=id?await ctx.db.get(id):null;
    if(!asset||asset.kind!=='audio'||asset.ownerId!==project.ownerId||asset.projectId!==project._id||!Number.isFinite(bake.targetLufs)||!Number.isFinite(bake.truePeak)||bake.truePeak> -1||bake.key.length>100||bake.offset!==undefined&&(!Number.isFinite(bake.offset)||bake.offset<0))throw new ConvexError('The normalized timeline mix is unavailable.');
  }
  try { validateAudioTimeline(timeline); } catch(error) { throw new ConvexError((error as Error).message); }
  // Sections were removed; drop any a saved timeline still carries.
  const { sections: _sections, ...kept } = timeline as Timeline & { sections?: unknown };
  return kept;
}
/** Assistant writes may not add same-layer collisions. This stays out of
 * validateTimeline: saved, imported and history snapshots can already contain
 * overlaps (older trims did), and those must keep loading, rendering and undoing. */
export function rejectNewLayerOverlaps(before: Timeline, after: Timeline) {
  const collision = newLayerOverlaps(before, after)[0];
  if (collision) throw runFailure('invalid', `Clips ${collision[0].id} and ${collision[1].id} would overlap on the same layer. Move one to another time or layer first.`);
}
/** Find an ordered anchor, preferring the earliest equal-scoring match so an
 * identical future state cannot reappear after an older local undo. */
function matchedUndoHistory(saved: string[], preceding: string[], target: string) {
  if (!preceding.length) return [];
  const matches = Array.from({ length: saved.length + 1 }, () => Array<number>(preceding.length + 1).fill(0));
  let anchor = -1, anchorScore = 0, exact = -1, exactScore = -1;
  for (let row = 0; row < saved.length; row++) {
    if (saved[row] === target && matches[row][preceding.length] > exactScore) { exact = row; exactScore = matches[row][preceding.length]; }
    for (let column = 0; column < preceding.length; column++) matches[row + 1][column + 1] = saved[row] === preceding[column] ? matches[row][column] + 1 : Math.max(matches[row][column + 1], matches[row + 1][column]);
    if (matches[row + 1][preceding.length] > anchorScore) { anchor = row; anchorScore = matches[row + 1][preceding.length]; }
  }
  const exactMatchesPast = (exactScore > 0 || exact === 0) && exactScore === anchorScore;
  const boundary = exactMatchesPast ? exact : anchor + 1;
  const retained: number[] = [];
  let row = boundary, column = preceding.length;
  while (row > 0 && column > 0) {
    if (matches[row - 1][column] === matches[row][column]) row--;
    else if (saved[row - 1] === preceding[column - 1]) { retained.push(row - 1); row--; column--; }
    else column--;
  }
  return retained.reverse();
}

export async function commitTimeline(ctx: MutationCtx, project: Doc<"projects">, timeline: Timeline, expectedRevision: number, undoTo?: Timeline, undoHistoryKeys?: string[], undoTargetKey?: string, note?: RevisionNote) {
  if ((project.revision ?? 0) !== expectedRevision) throw new ConvexError(TIMELINE_CONFLICT);
  timeline = await validateTimeline(ctx, project, timeline);
  const revision = expectedRevision + 1, current = currentTimeline(project);
  // The write seam reads history once; retained rows are kept, not rewritten.
  await writeProject(ctx, project._id, { timeline, aspectRatio: timeline.aspectRatio, revision, updatedAt: Date.now() }, async previous => {
    if (!undoTo) return [...previous, { timeline: current }];
    // Undo consumes history instead of recording its old state as a new edit.
    // A following gesture may share this save; retain its actual undo target.
    const target = normalizeTimeline(undoTo);
    let history: HistoryEntry[];
    if (undoHistoryKeys === undefined) {
      // Keep earlier clients compatible during the backend-first rollout.
      const keys = undoTargetKey ? await historyKeys(ctx, previous) : undefined;
      const snapshots = keys ? undefined : await historyTimelines(ctx, previous);
      let index = -1;
      for (let candidate = previous.length - 1; candidate >= 0; candidate--) {
        if (keys ? keys[candidate] === undoTargetKey : equalTimelineValue(normalizeTimeline(snapshots![candidate].timeline), target)) { index = candidate; break; }
      }
      history = index < 0 ? [] : previous.slice(0, index);
      if (index >= 0 && !equalTimelineValue(timeline, target)) history.push({ timeline: await validateTimeline(ctx, project, target) });
    } else {
      const matched = matchedUndoHistory(await historyKeys(ctx, previous), undoHistoryKeys, undoTargetKey ?? await timelineHistoryKey(target));
      // Unsaved intermediate gestures have no exact server snapshot. Their
      // preceding local fingerprints still identify the valid persisted past.
      history = matched.map(index => previous[index]);
      if (!equalTimelineValue(timeline, target)) history.push({ timeline: await validateTimeline(ctx, project, target) });
    }
    return history;
  }, note ?? (undoTo ? { tool: 'Undo' } : undefined));
  return revision;
}
