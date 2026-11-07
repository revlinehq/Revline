import { sourceEndOf, sourceTimeAt } from '../../../editor/playback-rate';
import { currentEvidence, type LaneCheckContext } from '../types';

const range = (start: number, end: number) => `${start.toFixed(2)}–${end.toFixed(2)}s`;

/** Every Genesis layer on this timeline is ready, covers its clip, stays in sync, and was looked at after the last edit. */
export function check(context: LaneCheckContext): string[] {
  const failures: string[] = [], clips = new Map(context.timeline.clips.map(clip => [clip.id, clip]));
  const spans: { start: number; end: number }[] = [];
  for (const layer of context.genesis ?? []) {
    for (const use of layer.applications.filter(use => use.timelineId === context.timelineId)) {
      const placed = use.clipIds.map(id => clips.get(id)).filter(clip => !!clip);
      if (!placed.length) continue;
      const base = clips.get(use.baseClipId), label = `${use.function} on layer ${layer.layerId}`;
      if (layer.status !== 'ready' || !layer.outputAssetId) { failures.push(`${label}: the layer is ${layer.status}. Poll getLayer until ready, or segment again.`); continue; }
      if (!base) { failures.push(`${label}: its footage clip ${use.baseClipId} was removed. Delete clips ${placed.map(clip => clip.id).join(', ')} or re-apply on the new footage.`); continue; }
      const frame = 1 / layer.fps;
      // Titles keep their own timing; only video copies (plates and subjects) must match the footage.
      for (const copy of placed.filter(clip => clip.kind === 'video')) {
        // Copies must show the same source instant as the footage at every timeline time.
        if (Math.abs(copy.start - base.start) > 1e-3 || Math.abs(copy.duration - base.duration) > 1e-3 || Math.abs(sourceTimeAt(copy, copy.start) - sourceTimeAt(base, copy.start)) > frame / 2 || (copy.playbackRate ?? 1) !== (base.playbackRate ?? 1) || JSON.stringify(copy.speedRamp ?? null) !== JSON.stringify(base.speedRamp ?? null))
          failures.push(`${label}: clip ${copy.id} is out of sync with footage ${base.id}. Move/trim it to match (start ${base.start.toFixed(3)}, duration ${base.duration.toFixed(3)}, sourceStart ${base.sourceStart.toFixed(3)}) or re-apply.`);
      }
      for (const subject of use.subjectClipIds.map(id => clips.get(id)).filter(clip => !!clip)) {
        if (subject.assetId !== layer.outputAssetId) { failures.push(`${label}: clip ${subject.id} no longer uses the layer's mask.`); continue; }
        const from = subject.sourceStart, to = sourceEndOf(subject);
        if (from < layer.start - frame || to > layer.end + frame) { failures.push(`${label}: clip ${subject.id} plays source ${range(from, to)} but the mask covers only ${range(layer.start, layer.end)}. Split the footage or segment the range.`); continue; }
        const boxes = layer.boxes ?? [], first = Math.max(0, Math.floor((from - layer.start) * layer.fps)), last = Math.min(boxes.length, Math.ceil((to - layer.start) * layer.fps));
        if (boxes.length && !boxes.slice(first, last).some(box => box)) failures.push(`${label}: the mask is empty over source ${range(from, to)}; SAM 3.1 lost the subject. Segment again with a box on a clear frame.`);
      }
      spans.push({ start: base.start, end: base.start + base.duration });
    }
  }
  if (!spans.length) return failures;
  // Frames read at the current timeline fingerprint were taken after the last edit, Genesis included.
  const seen = currentEvidence(context, 'getFrames').flatMap(item => Array.isArray(item.input.times) ? item.input.times.filter((time): time is number => typeof time === 'number') : []);
  const unseen = spans.filter(span => !seen.some(time => time >= span.start - 1e-3 && time < span.end));
  if (unseen.length) failures.push(`No getFrames after the last Genesis edit inside ${unseen.map(span => range(span.start, span.end)).join(', ')}. Call getFrames with times ${JSON.stringify(unseen.map(span => Math.round((span.start + span.end) / 2 * 100) / 100))} and look at the subject edges.`);
  return failures;
}
