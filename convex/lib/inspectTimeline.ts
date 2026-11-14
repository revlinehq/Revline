import { layerGroup, normalizeTimeline, timelineDuration, trackOf, type LayerGroup, type Timeline } from "../../lib/editor/types";
import { selectedTextEffect,TEXT_EFFECT_LABELS } from '../../lib/editor/text-effects';
import { TEXT_TEMPLATE_LABELS } from '../../lib/editor/text-templates';
import { footageGaps } from '../../lib/editor/frame-grid';
import { soundMisalignments } from '../../lib/editor/join-clips';

/** Visual coverage gaps and same-layer collisions; stacked layers are intentional. */
export function summarizeTimeline(timeline: Timeline, assets: { _id: string; kind: string; audioAssetId?: string }[]) {
  timeline = normalizeTimeline(timeline);
  const duration = timelineDuration(timeline);
  const gaps: { start: number; end: number }[] = [];
  let coveredUntil = 0;
  for (const clip of timeline.clips.filter(clip => clip.kind === "video" || clip.kind === "image" || clip.kind === "solid" || clip.kind === "scene").sort((a, b) => a.start - b.start)) {
    if (clip.start > coveredUntil + 0.000001) gaps.push({ start: coveredUntil, end: clip.start });
    coveredUntil = Math.max(coveredUntil, clip.start + clip.duration);
  }
  if (duration > coveredUntil + 0.000001) gaps.push({ start: coveredUntil, end: duration });

  const overlaps: { group: LayerGroup; track: number; clipIds: string[]; start: number; end: number }[] = [];
  let overlapCount = 0;
  for (let first = 0; first < timeline.clips.length; first++) {
    const a = timeline.clips[first];
    for (let second = first + 1; second < timeline.clips.length; second++) {
      const b = timeline.clips[second];
      if (layerGroup(a.kind) !== layerGroup(b.kind) || trackOf(a) !== trackOf(b)) continue;
      const start = Math.max(a.start, b.start); const end = Math.min(a.start + a.duration, b.start + b.duration);
      if (end <= start + 0.000001) continue;
      overlapCount++;
      if (overlaps.length < 100) overlaps.push({ group: layerGroup(a.kind), track: trackOf(a), clipIds: [a.id, b.id], start, end });
    }
  }
  const assetById = new Map(assets.map(asset => [asset._id, asset]));
  const missingAssetRefs = timeline.clips.filter(clip => ["video", "image", "audio"].includes(clip.kind) && (!clip.assetId || assetById.get(clip.assetId)?.kind !== clip.kind)).map(clip => ({ clipId: clip.id, assetId: clip.assetId ?? null }));
  const textAnimations=timeline.clips.filter(clip=>clip.kind==='caption'||clip.kind==='graphic').map(clip=>{
    const effect=selectedTextEffect(clip);
    const labels=effect&&effect!=='none'?[TEXT_EFFECT_LABELS[effect]]:clip.motion?.length?['Custom keyframe motion']:[];
    if(clip.textTemplate)labels.push(TEXT_TEMPLATE_LABELS[clip.textTemplate.preset]);
    return {clipId:clip.id,labels:labels.length?labels:['None']};
  });
  // Holes between footage on each layer (also ones the user left after splitting and deleting pieces) and sound that
  // no longer lines up with its picture: read here, never from frames, each with the call that fixes it.
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const layerGaps = footageGaps(timeline).map(gap => ({ track: `V${gap.track}`, start: round(gap.start), end: round(gap.end), seconds: round(gap.end - gap.start), ...(gap.afterClipId ? { afterClipId: gap.afterClipId } : {}), ...(gap.beforeClipId ? { beforeClipId: gap.beforeClipId } : {}) }));
  const audioAssetOf = (assetId: string) => assets.find(asset => asset._id === assetId)?.audioAssetId;
  const misaligned = soundMisalignments(timeline, audioAssetOf);
  const footageFix = layerGaps.length || misaligned.length ? [
    layerGaps.length ? `${layerGaps.length} gap${layerGaps.length === 1 ? '' : 's'} between footage: closeGaps {} closes every gap on the main footage layer in ONE call (sound and captions move with their footage); joinClips {at} or {clipIds} also merges two pieces of one take into one clip.` : '',
    misaligned.length ? `${misaligned.length} footage piece${misaligned.length === 1 ? "'s" : "s'"} sound does not line up with the picture: closeGaps {} or joinClips puts each piece's own sound back in sync and on the picture's in/out.` : '',
  ].filter(Boolean).join(' ') : undefined;
  return { duration, clipCount: timeline.clips.length, gaps, ...(layerGaps.length ? { footageGaps: layerGaps.slice(0, 50) } : {}), ...(misaligned.length ? { soundMisaligned: misaligned.slice(0, 50) } : {}), ...(footageFix ? { footageFix } : {}), gapScope: "visual coverage" as const, overlaps, overlapScope: "same group and track" as const, overlapCount, overlapsTruncated: overlapCount > overlaps.length, missingAssetRefs,textAnimations };
}
