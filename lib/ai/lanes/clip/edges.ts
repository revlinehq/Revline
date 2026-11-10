import { sourceEndOf, sourceTimeAt } from '../../../editor/playback-rate';
import type { Clip, Timeline } from '../../../editor/types';
import { LOOKS_UNMEASURED, type LookSample } from '../../eyes';

/** Frames read on each side of a cut: up to three stray frames plus the steady shot beside them. */
const EDGE_FRAMES = 5;
/** A stray run longer than this is a short shot, not a flash. */
const MAX_STRAY_FRAMES = 3;
/** Mean gray change (0..1) between two neighbouring frames that only a shot change produces... */
const CUT_CHANGE = .08;
/** ...when it is also this many times the change between the other frames at the same edge (fast action and strobing are not a cut). */
const CUT_RATIO = 4;

export type ClipEdge = {
  clipId: string;
  assetId: string;
  side: 'in' | 'out';
  /** Timeline second of the cut. */
  timeline: number;
  /** SOURCE seconds read for the frames shown at this edge, in playing order: the first shown frame leads an in
   * edge, the last shown frame ends an out edge. Each is the middle of its timeline frame, so a time on a source
   * frame boundary cannot round onto the frame before it. */
  times: number[];
};

const millisecond = (time: number) => Math.round(time * 1000) / 1000;
const visibleVideo = (clip: Clip) => clip.kind === 'video' && !!clip.assetId && (clip.transform?.opacity ?? 1) > 0;

/** The first and last frames of every visible video clip: each is a cut edge of the finished short, unless the
 * neighbouring clip carries the same source on without a break (a split for an effect or a speed change). */
export function clipEdges(timeline: Timeline): ClipEdge[] {
  const frame = 1 / timeline.fps, edges: ClipEdge[] = [], videos = timeline.clips.filter(visibleVideo);
  const near = (a: number, b: number) => Math.abs(a - b) <= frame / 2;
  for (const clip of videos) {
    const count = Math.min(EDGE_FRAMES, Math.floor(clip.duration * timeline.fps + 1e-6));
    // Fewer than three frames cannot show a stray frame against a steady shot.
    if (count < 3) continue;
    const end = clip.start + clip.duration;
    const continues = {
      in: videos.some(other => other !== clip && other.assetId === clip.assetId && near(other.start + other.duration, clip.start) && near(sourceEndOf(other), clip.sourceStart)),
      out: videos.some(other => other !== clip && other.assetId === clip.assetId && near(other.start, end) && near(other.sourceStart, sourceEndOf(clip))),
    };
    const sides = [
      { side: 'in' as const, timeline: clip.start, times: Array.from({ length: count }, (_, index) => sourceTimeAt(clip, clip.start + (index + .5) * frame)) },
      { side: 'out' as const, timeline: end, times: Array.from({ length: count }, (_, index) => sourceTimeAt(clip, end - (count - index - .5) * frame)) },
    ];
    for (const { side, timeline: at, times } of sides) {
      if (continues[side]) continue;
      const rounded = times.map(millisecond);
      // A freeze, a reversed clip or a very fast clip has no neighbouring source frames to compare.
      if (rounded.some((time, index) => time < 0 || index > 0 && (time <= rounded[index - 1] || time - rounded[index - 1] > .25))) continue;
      edges.push({ clipId: clip.id, assetId: clip.assetId!, side, timeline: at, times: rounded });
    }
  }
  return edges;
}

/** Frames of the neighbouring shot left at an edge: one to three frames separated from the steady rest by a shot
 * change. `unmeasured` when the worker returned no reading for these frames. */
export function strayFrames(edge: ClipEdge, samples: LookSample[]): number | 'unmeasured' {
  const ordered = [...samples].sort((a, b) => a.time - b.time);
  // The change into each frame from the one before it. Frames of another edge may sit between two of ours, so
  // take the largest step inside the interval: a shot change shows in exactly one of them.
  const changes: number[] = [];
  for (let index = 1; index < edge.times.length; index++) {
    const from = edge.times[index - 1], to = edge.times[index];
    const steps = ordered.filter(sample => sample.time > from + .0005 && sample.time <= to + .0005);
    if (!steps.some(sample => Math.abs(sample.time - to) <= .0005) || steps.some(sample => sample.motion === null)) return 'unmeasured';
    changes.push(Math.max(...steps.map(sample => sample.motion!)));
  }
  const cuts = changes.flatMap((change, index) => {
    const others = changes.filter((_, other) => other !== index);
    return change >= CUT_CHANGE && change >= CUT_RATIO * Math.max(...others, .001) ? [index] : [];
  });
  if (cuts.length !== 1) return 0;
  // changes[i] sits between frame i and frame i + 1.
  const stray = edge.side === 'in' ? cuts[0] + 1 : changes.length - cuts[0];
  return stray > MAX_STRAY_FRAMES ? 0 : stray;
}

/** Reads the frames at every cut edge of these tabs and reports stray frames of a neighbouring shot, one failure
 * per clip with the trim that drops them. `read` measures SOURCE frames of one asset (the shared looks read); when
 * it cannot, the check warns and passes. */
export async function checkClipEdges(
  tabs: { label: string; timeline: Timeline }[],
  read: (assetId: string, times: number[]) => Promise<LookSample[]>,
): Promise<{ failures: string[]; warnings: string[] }> {
  const edges = tabs.flatMap(tab => clipEdges(tab.timeline).map(edge => ({ ...edge, tab })));
  if (!edges.length) return { failures: [], warnings: [] };
  const samples = new Map<string, LookSample[]>();
  try {
    await Promise.all([...new Set(edges.map(edge => edge.assetId))].map(async assetId => {
      const times = [...new Set(edges.filter(edge => edge.assetId === assetId).flatMap(edge => edge.times))].sort((a, b) => a - b), found: LookSample[] = [];
      for (let index = 0; index < times.length; index += 480) found.push(...await read(assetId, times.slice(index, index + 480)));
      samples.set(assetId, found);
    }));
  } catch (error) {
    return { failures: [], warnings: [`Clip ${LOOKS_UNMEASURED} (${error instanceof Error ? error.message : 'the media worker did not answer'}).`] };
  }
  const failures: string[] = [];
  let unmeasured = 0;
  for (const tab of tabs) for (const clip of tab.timeline.clips) {
    const own = edges.filter(edge => edge.tab === tab && edge.clipId === clip.id), frame = 1 / tab.timeline.fps;
    const found = own.flatMap(edge => {
      const stray = strayFrames(edge, samples.get(edge.assetId) ?? []);
      if (stray === 'unmeasured') unmeasured++;
      return typeof stray === 'number' && stray > 0 ? [{ edge, stray }] : [];
    });
    if (!found.length) continue;
    const start = found.find(item => item.edge.side === 'in'), end = found.find(item => item.edge.side === 'out');
    // One trim for the clip. A new start is the measured middle of the first frame of its own shot, half a frame
    // past the boundary, so the trimmed clip cannot round back onto the stray frame.
    const trim = { clipId: clip.id, ...(start ? { sourceStart: start.edge.times[start.stray] } : {}), duration: millisecond(clip.duration - (start ? (start.stray + .5) * frame : 0) - (end ? end.stray * frame : 0)) };
    const count = (frames: number) => `${frames} frame${frames === 1 ? '' : 's'}`;
    const where = [
      ...(start ? [`the cut in at ${start.edge.timeline.toFixed(2)} s starts with ${count(start.stray)} of a neighbouring shot (source ${start.edge.times[0].toFixed(3)} s) before the shot it belongs to`] : []),
      ...(end ? [`the cut out at ${end.edge.timeline.toFixed(2)} s ends with ${count(end.stray)} of a neighbouring shot (source ${end.edge.times.at(-1)!.toFixed(3)} s) after the shot it belongs to`] : []),
    ].join(', and ');
    failures.push(`${tab.label}${where[0].toUpperCase()}${where.slice(1)}. Fix: trim ${JSON.stringify(trim)}.`);
  }
  return { failures, warnings: unmeasured ? [`${unmeasured} of ${edges.length} clip ${LOOKS_UNMEASURED}.`] : [] };
}
