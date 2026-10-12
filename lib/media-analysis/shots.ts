import { z } from 'zod';
import { AnalysisError } from './errors';

export const shotsSchema = z.object({ fps: z.number().positive().max(240), shots: z.array(z.object({ start: z.number().nonnegative(), end: z.number().positive(), startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() })).min(1).max(1000) });
export type ShotDetection = z.infer<typeof shotsSchema>;

export function parseShots(value: unknown, duration: number): ShotDetection {
  const parsed = shotsSchema.safeParse(value);
  if (!parsed.success) throw new AnalysisError('Shot detection returned invalid boundaries.', 502);
  const { fps, shots } = parsed.data;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (shot.end <= shot.start || shot.endFrame <= shot.startFrame || shot.start >= duration || shot.end > duration + 1 / fps + 0.05 || Math.abs(shot.start - shot.startFrame / fps) > 0.001 || Math.abs(shot.end - shot.endFrame / fps) > 0.001 || (i === 0 ? shot.startFrame !== 0 : shot.startFrame !== shots[i - 1].endFrame)) throw new AnalysisError('Shot detection returned invalid source timing.', 502);
  }
  if (Math.abs(shots.at(-1)!.end - duration) > 1 / fps + 0.05) throw new AnalysisError('Shot detection did not inspect the complete video.', 502);
  return parsed.data;
}

/** Snap approximate semantic scene edges to the nearest observed cut, retaining at least one shot. */
export function shotAlignedRange(scene: { start: number; end: number }, detection?: ShotDetection) {
  if (!detection) return scene;
  const { shots } = detection;
  const boundaries = [shots[0].start, ...shots.map(shot => shot.end)];
  const closest = (time: number) => boundaries.reduce((nearest, boundary) => Math.abs(boundary - time) < Math.abs(nearest - time) ? boundary : nearest);
  const start = closest(scene.start), end = closest(scene.end);
  if (end > start) return { start, end };
  const midpoint = (scene.start + scene.end) / 2;
  const containing = shots.find(shot => midpoint >= shot.start && midpoint < shot.end) ?? shots.at(-1)!;
  return { start: containing.start, end: containing.end };
}
