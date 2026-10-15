import { validateVisualTransform } from '../../lib/editor/visual-inputs';
import { writeProject } from './project_data';
import { validateClipEffects } from '../../lib/editor/clip-effects';
import { playbackRateOf, sourceEndOf } from '../../lib/editor/playback-rate';
import { transitionSources } from '../../lib/editor/clip-transitions';
import { validateVisualFade } from '../../lib/editor/visual-fades';
import { validateAudioTimeline } from '../../lib/editor/audio-settings';
import { ConvexError } from "convex/values";
import { layerGroup, maxTrackCount, normalizeTimeline, trackOf, type Timeline } from "../../lib/editor/types";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export function serializedBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function boundedHistory(history: Timeline[]) {
  const snapshots = history.slice(-10).map(normalizeTimeline);
  while (snapshots.length && serializedBytes(snapshots) > 500_000) snapshots.shift();
  return snapshots;
}
export function currentTimeline(project: Doc<"projects">): Timeline {
  return normalizeTimeline(project.timeline ?? { clips: [], fps: 30, aspectRatio: project.aspectRatio });
}
export function validateFocus(focus: { time: number; x: number; y: number }[], duration = 86400) {
  if (focus.length > 1500 || focus.some((sample, i) => !Number.isFinite(sample.time) || sample.time < 0 || sample.time > duration + 0.5 || !Number.isFinite(sample.x) || !Number.isFinite(sample.y) || sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1 || (i > 0 && sample.time <= focus[i - 1].time))) throw new ConvexError("Invalid subject tracking samples");
}
export async function validateTimeline(ctx: MutationCtx | QueryCtx, project: Doc<"projects">, timeline: Timeline) {
  if (serializedBytes(timeline) > 150_000) throw new ConvexError("Timeline is too large. Shorten text or reduce subject tracking samples.");
  if (![24, 30, 60].includes(timeline.fps)) throw new ConvexError("Choose 24, 30, or 60 fps");
  const markerIds = new Set<string>();
  for (const marker of timeline.markers ?? []) {
    if (!marker.id || marker.id.length > 100 || markerIds.has(marker.id)) throw new ConvexError('Marker IDs must be unique and nonempty');
    if (!Number.isFinite(marker.time) || marker.time < 0) throw new ConvexError('Marker time must be finite and nonnegative');
    if ((marker.label?.length ?? 0) > 120) throw new ConvexError('Marker labels support up to 120 characters');
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
      if (Math.abs(playbackRateOf(clip) - playbackRateOf(pair)) > 1e-7) throw new ConvexError('Linked video and audio must stay synchronized');
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
    if (clip.kind === 'effect' || clip.kind === 'solid') continue;
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
  try { validateAudioTimeline(timeline); } catch(error) { throw new ConvexError((error as Error).message); }
  return timeline;
}
export async function commitTimeline(ctx: MutationCtx, project: Doc<"projects">, timeline: Timeline, expectedRevision: number) {
  if ((project.revision ?? 0) !== expectedRevision) throw new ConvexError("The timeline changed elsewhere. Reload before saving.");
  timeline = await validateTimeline(ctx, project, timeline);
  const revision = expectedRevision + 1;
  await writeProject(ctx,project._id, { timeline, aspectRatio: timeline.aspectRatio, revision, history: boundedHistory([...(project.history ?? []), currentTimeline(project)]), updatedAt: Date.now() });
  return revision;
}
