import { timelineDuration, type Timeline } from '../../../editor/types';
import { missingMotionWindow, motionRange, type MotionWindow } from '../../motion-coverage';
import { currentEvidence, type LaneCheckContext, type ReferenceMotionEvidence } from '../types';

type ReferenceAsset = { _id: string; kind: string; duration?: number; motionReferenceTimelines?: string[] };
export type ReferenceMotionTarget = Pick<ReferenceMotionEvidence, 'assetId' | 'start' | 'end' | 'offset' | 'referenceDuration'>;

/** Saved film bindings survive separate MCP calls; a recreate task can also identify its one mapped source. */
export function referenceMotionTargets(timeline: Timeline, assets: ReferenceAsset[], timelineId: string, required: boolean): ReferenceMotionTarget[] {
  const bound = timeline.clips.flatMap(clip => {
    const film = clip.scene?.film, asset = assets.find(asset => asset._id === film?.referenceAssetId && asset.kind === 'video');
    if (!film || !asset) return [];
    const start = (film.referenceStart ?? 0) + clip.sourceStart;
    return [{ assetId: asset._id, start, end: Math.min(start + clip.duration * (clip.playbackRate ?? 1), asset.duration ?? Infinity), offset: clip.start - start, referenceDuration: asset.duration }];
  });
  if (bound.length || !required) return bound;
  const videos = assets.filter(asset => asset.kind === 'video'), mapped = videos.filter(asset => asset.motionReferenceTimelines?.includes(timelineId));
  const reference = mapped.length === 1 ? mapped[0] : !mapped.length && videos.length === 1 ? videos[0] : undefined;
  return reference ? [{ assetId: reference._id, start: 0, end: Math.min(timelineDuration(timeline), reference.duration ?? Infinity), offset: 0, referenceDuration: reference.duration }] : [];
}

const EPSILON = .001;
const exempt = (window: MotionWindow, evidence: ReferenceMotionEvidence) => !missingMotionWindow(window.start, window.end, evidence.off);
const openDifferences = (check: ReferenceMotionEvidence['checks'][number], evidence: ReferenceMotionEvidence) => exempt(check, evidence) ? [] : check.differences.filter(item => item.time - evidence.offset >= evidence.start - EPSILON && item.time - evidence.offset <= evidence.end + EPSILON && !evidence.off.some(off => item.time - evidence.offset >= off.start - EPSILON && item.time - evidence.offset <= off.end + EPSILON));

function recovery(evidence: ReferenceMotionEvidence, window: MotionWindow, timelineId: string, pixels = false) {
  const start = pixels ? window.start : Math.max(evidence.start, Math.min(window.start, window.end - .3)), end = Math.min(evidence.end, window.end);
  const source = { projectId: evidence.projectId, timelineId, assetId: evidence.assetId, start, end };
  const tooShort = !pixels && end - start < .3;
  const off = { tool: 'motionMap', arguments: { ...source, off: { time: window.start, reason: tooShort ? "The retained reference window is shorter than motionMap's 0.3 s measurement minimum." : 'Describe the measurement limitation at this time (12–500 characters).' } } };
  const read = pixels ? { tool: 'compareReference', arguments: { ...source, fps: 10, offset: evidence.offset } } : { tool: 'motionMap', arguments: { ...source, timelineStart: start + evidence.offset } };
  return `Next call: ${JSON.stringify(tooShort ? off : read)}. If unmeasurable or after 2 failures, mark OFF with a concrete timed reason: ${JSON.stringify(off)}. OFF never means matched.`;
}

/** A lane finishes from real current comparison rows; display strings and claimed tool scores are never evidence. */
export function referenceMotionFailures(context: LaneCheckContext): string[] {
  const failures: string[] = [];
  for (const evidence of context.referenceMotion ?? []) {
    if (!(evidence.end > evidence.start && Number.isFinite(evidence.start) && Number.isFinite(evidence.end))) {
      failures.push('The reference window is empty or outside the source. Use askUser to identify a readable reference before claiming a match.');
      continue;
    }
    const full = evidence.checks.filter(check => check.end > evidence.start && check.start < evidence.end && check.scope === 'full' && check.revision === evidence.revision && check.timelineKey === evidence.timelineKey && Math.abs(check.timelineStart - check.start - evidence.offset) < EPSILON);
    const clean = full.filter(check => !openDifferences(check, evidence).length);
    for (const check of full) {
      const differences = openDifferences(check, evidence);
      const window = { start: Math.max(evidence.start, check.start), end: Math.min(evidence.end, check.end) };
      if (differences.length) failures.push(`${differences.length} open motion differences in ${motionRange(window)}. ${recovery(evidence, window, context.timelineId)}`);
    }
    let reached = evidence.start;
    for (;;) {
      const gap = missingMotionWindow(reached, evidence.end, [...clean, ...evidence.off]);
      if (!gap) break;
      failures.push(`Motion ${motionRange(gap)} has no clean check on the current revision and draft. ${recovery(evidence, gap, context.timelineId)}`);
      reached = gap.end;
    }
    // Whole-film review uses actual paired samples at 10 fps. Pixel scores remain diagnostics, with no pass threshold.
    const pixels = currentEvidence(context, 'compareReference').flatMap(item => {
      const input = item.input;
      if (input.assetId !== evidence.assetId || input.crop || input.referenceCrop || input.timelineCrop || input.referenceCropKeyframes || Number(input.fps ?? 15) < 10 || Math.abs(Number(input.offset ?? 0) - evidence.offset) > EPSILON) return [];
      const scores = item.output.scores;
      if (!Array.isArray(scores) || scores.some(score => !Number.isFinite(score.time) || !Number.isFinite(score.difference))) return [];
      const times = scores.map(score => Number(score.time)).sort((a, b) => a - b);
      return times.slice(1).flatMap((time, index) => time > times[index] && time - times[index] <= .1 + EPSILON ? [{ start: times[index], end: time }] : []);
    });
    reached = evidence.start;
    for (;;) {
      const gap = missingMotionWindow(reached, evidence.end, [...pixels, ...evidence.off]);
      if (!gap) break;
      const batch = { start: gap.start, end: Math.min(gap.end, gap.start + 5.9) };
      failures.push(`Review ${motionRange(batch)} beside the reference at 10 fps. ${recovery(evidence, batch, context.timelineId, true)}`);
      reached = batch.end;
    }
  }
  return failures;
}
