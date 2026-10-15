import type { SegmentationMaskRecord, SegmentationRecord } from '@meta-sam/parser';
import type { FocusSample } from '../editor/tracking';

/** Interpolate measured face centers only inside the sampled source range. */
export function trackedSubjectAt(samples: readonly FocusSample[], time: number): { x: number; y: number } | undefined {
  if (!samples.length || !Number.isFinite(time) || time < samples[0].time || time > samples[samples.length - 1].time + .5) return;
  const after = samples.findIndex(sample => sample.time >= time);
  if (after === -1) return samples[samples.length - 1];
  if (after === 0) return samples[0];
  const first = samples[after - 1], last = samples[after];
  const progress = (time - first.time) / (last.time - first.time);
  return { x: first.x + (last.x - first.x) * progress, y: first.y + (last.y - first.y) * progress };
}

export type SubjectMaskIndex = { frames: Map<number, SegmentationMaskRecord[]>; global: SegmentationMaskRecord[]; objects: string[]; count: number };

/** SAM snapshots are cumulative; retain the latest revision of each real mask. */
export function indexSubjectMasks(records: readonly SegmentationRecord[]): SubjectMaskIndex {
  const latest = new Map<string, SegmentationMaskRecord>();
  for (const record of records) if (record.kind === 'mask' && (latest.get(record.identity)?.revision ?? 0) < record.revision) latest.set(record.identity, record);
  const frames = new Map<number, SegmentationMaskRecord[]>(), global: SegmentationMaskRecord[] = [], objects = new Set<string>();
  for (const record of latest.values()) {
    objects.add(record.objectId);
    if (record.frame === undefined) global.push(record);
    else {
      const group = frames.get(record.frame.frameIndex) ?? [];
      group.push(record); frames.set(record.frame.frameIndex, group);
    }
  }
  return { frames, global, objects: [...objects], count: latest.size };
}

/** No nearest-frame substitution: a missing mask must not imply a detected subject. */
export function subjectMasksAt(index: SubjectMaskIndex, frameIndex: number, objectId = 'all') {
  return [...index.global, ...(index.frames.get(frameIndex) ?? [])].filter(record => objectId === 'all' || record.objectId === objectId);
}
