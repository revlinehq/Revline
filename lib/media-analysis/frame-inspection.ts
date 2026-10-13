import { z } from 'zod';
export const MAX_FRAME_WINDOW = 3;
export const MAX_INSPECTION_FRAMES = 12;
export type FrameInspectionInput = { start: number; end: number; question: string };
export type FrameSample = { frameIndex: number; time: number };
export type FrameInspection = FrameInspectionInput & {
  sourceFps: number; sampleInterval: number; consecutive: boolean;
  summary: string; uncertainty: string;
  frames: (FrameSample & { observation: string })[];
  events: (FrameSample & { description: string; confidence: 'low' | 'medium' | 'high' })[];
};

export function validateFrameInspectionInput(input: FrameInspectionInput, duration: number) {
  if (![input.start, input.end, duration].every(Number.isFinite) || input.start < 0 || input.end <= input.start || input.end > duration + 1e-6 || input.end - input.start > MAX_FRAME_WINDOW + 1e-6) throw new Error('Inspect a source window of up to three seconds within this video.');
  if (!input.question.trim() || input.question.length > 1000) throw new Error('Ask a focused visual question of 1–1000 characters.');
}

export function selectInspectionFrames(frames: FrameSample[], input: FrameInspectionInput) {
  const inside = frames.filter(frame => frame.time >= input.start - 1e-6 && frame.time < input.end - 1e-6);
  if (!inside.length) throw new Error('No decoded video frame falls in that window. Widen it by a frame.');
  if (inside.length <= MAX_INSPECTION_FRAMES) return inside;
  return Array.from({ length: MAX_INSPECTION_FRAMES }, (_, index) => inside[Math.round(index * (inside.length - 1) / (MAX_INSPECTION_FRAMES - 1))]);
}

const observation = z.object({ frameIndex: z.number().int().nonnegative(), observation: z.string().min(1).max(800) });
const event = z.object({ frameIndex: z.number().int().nonnegative(), description: z.string().min(1).max(500), confidence: z.enum(['low', 'medium', 'high']) });
const response = z.object({ summary: z.string().max(2000), uncertainty: z.string().max(2000), frames: z.array(observation).min(1).max(MAX_INSPECTION_FRAMES), events: z.array(event).max(MAX_INSPECTION_FRAMES) });
export const frameInspectionJsonSchema = z.toJSONSchema(response);

export function parseFrameInspection(text: string, input: FrameInspectionInput, samples: FrameSample[], sourceFps: number): FrameInspection {
  const parsed = response.parse(JSON.parse(text));
  const byIndex = new Map(samples.map(frame => [frame.frameIndex, frame]));
  if (new Set(parsed.frames.map(frame => frame.frameIndex)).size !== samples.length || parsed.frames.length !== samples.length || parsed.frames.some(frame => !byIndex.has(frame.frameIndex)) || parsed.events.some(item => !byIndex.has(item.frameIndex))) throw new Error('Frame evidence must refer to the exact frames that were inspected.');
  const observed = new Map(parsed.frames.map(frame => [frame.frameIndex, frame.observation]));
  const result = { ...input, sourceFps, sampleInterval: Math.max(1 / sourceFps, ...samples.slice(1).map((frame, index) => frame.time - samples[index].time)), consecutive: samples.every((frame, index) => index === 0 || frame.frameIndex === samples[index - 1].frameIndex + 1), summary: parsed.summary, uncertainty: parsed.uncertainty, frames: samples.map(({ frameIndex, time }) => ({ frameIndex, time, observation: observed.get(frameIndex)! })), events: parsed.events.map(item => ({ ...item, time: byIndex.get(item.frameIndex)!.time })) };
  validateFrameInspectionResult(result, input);
  return result;
}

export function validateFrameInspectionResult(result: FrameInspection, input: FrameInspectionInput) {
  validateFrameInspectionInput(input, input.end);
  if (result.start !== input.start || result.end !== input.end || result.question !== input.question || !Number.isFinite(result.sourceFps) || result.sourceFps <= 0 || result.sourceFps > 1000 || !Number.isFinite(result.sampleInterval) || result.sampleInterval <= 0 || result.summary.length > 2000 || result.uncertainty.length > 2000 || !result.frames.length || result.frames.length > MAX_INSPECTION_FRAMES || result.events.length > MAX_INSPECTION_FRAMES) throw new Error('Invalid frame inspection result.');
  for (const [index, frame] of result.frames.entries()) {
    if (!Number.isInteger(frame.frameIndex) || frame.frameIndex < 0 || !Number.isFinite(frame.time) || frame.time < input.start - 1e-6 || frame.time >= input.end || !frame.observation.trim() || frame.observation.length > 800 || (index > 0 && (frame.time <= result.frames[index - 1].time || frame.frameIndex <= result.frames[index - 1].frameIndex))) throw new Error('Invalid frame evidence timestamp.');
  }
  const consecutive = result.frames.every((frame, index) => index === 0 || frame.frameIndex === result.frames[index - 1].frameIndex + 1);
  const interval = Math.max(1 / result.sourceFps, ...result.frames.slice(1).map((frame, index) => frame.time - result.frames[index].time));
  if (result.consecutive !== consecutive || Math.abs(result.sampleInterval - interval) > 1e-6) throw new Error('Frame sampling metadata does not match the evidence.');
  for (const event of result.events) if (!result.frames.some(frame => frame.frameIndex === event.frameIndex && frame.time === event.time) || !event.description.trim() || event.description.length > 500 || !['low', 'medium', 'high'].includes(event.confidence)) throw new Error('Events must refer to inspected frames.');
}
