import { z } from 'zod';
import { MOTION_EASINGS } from '../../../../editor/motion-path';
import { sourceEndOf, sourceTimeAt, validatePlaybackRate } from '../../../../editor/playback-rate';
import { bakeSpeedRamp, presetAnchors, SPEED_RAMP_PRESET_IDS, validateSpeedRamp, type SpeedRampPreset } from '../../../../editor/speed-ramp';
import type { Clip, Timeline } from '../../../../editor/types';
import { baseClip, placeStack, syncedCopy, type Applied, type ExistingStack, type ReadyLayer } from './layer';

const easing = z.union([z.enum(MOTION_EASINGS), z.tuple([z.number().min(0).max(1), z.number().min(-1).max(2), z.number().min(0).max(1), z.number().min(-1).max(2)])]);

export const retimeLayerInput = z.object({
  layerId: z.string().min(1),
  clipId: z.string().min(1).optional().describe('Footage clip; defaults to the clip the layer was segmented from.'),
  alsoLayerIds: z.array(z.string().min(1)).max(3).optional().describe('Layers that move with the subject and share its speed, such as an object it holds (segmented separately). They are removed from the background and retimed together.'),
  speed: z.number().min(.25).max(4).optional().describe('Constant subject speed (0.5 = half speed). Give exactly one of speed, preset or anchors.'),
  preset: z.enum(SPEED_RAMP_PRESET_IDS as [SpeedRampPreset, ...SpeedRampPreset[]]).optional().describe('A setSpeedRamp preset for the subject (slowmo-middle, hero, bullet, ramp-in, ...).'),
  anchors: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(.1).max(10), easing: easing.optional() }).strict()).min(2).max(12).optional().describe('setSpeedRamp anchors for the subject: x is a 0..1 fraction of the clip.'),
  alignAt: z.number().min(0).optional().describe('TIMELINE second where the subject is in step with the background (default the clip start). Example: alignAt the clip end makes a slowed subject arrive on time.'),
  fallback: z.enum(['bria', 'none']).optional().describe('Clean plate: when the free one cannot do the shot (moving camera, or masked pixels never uncovered): bria (default) erases with Bria Video Eraser at $0.14 per second, within the monthly allowance; none refuses instead (small never-uncovered specks are then texture-filled, up to 1% of the frame).'),
  dilate: z.number().min(.004).max(.05).optional().describe('Clean-plate fill margin past the mask edge (see removeObject).'),
}).strict();
export type RetimeLayerInput = z.infer<typeof retimeLayerInput>;

export const retimeLayerDescription = "Genesis (MCP only). Selective speed: only the segmented subject changes speed while the background keeps playing in real time. Builds (or reuses) the removeObject clean plate of this layer, so the original subject leaves no ghost, then stacks footage < clean plate (real time) < the subject cut-out at its own speed (plus alsoLayerIds, e.g. a held object, at the same speed): constant speed, a setSpeedRamp preset, or anchors (same conventions as setSpeedRamp). alignAt picks the timeline moment where subject and background are in step. The subject's retimed source range must stay inside the layer's masked range; a speed-up that runs past it is refused with the largest speed that fits. The clean plate follows removeObject's order: free for a static camera where the subject uncovers everything, otherwise Bria Video Eraser at $0.14/s within the monthly allowance (fallback none refuses). The first call starts the clean plate and returns status processing; call retimeLayer again with the same input until it applies. In v1 retimeLayer stands alone on its footage clip: no other Genesis function before or after it there. Check with getFrames at the alignAt moment and at both ends.";

const span = (clip: Pick<Clip, 'playbackRate' | 'speedRamp' | 'start' | 'sourceStart'>, seconds: number) => sourceTimeAt({ ...clip, start: 0, sourceStart: 0 }, seconds);

/** The subject's timing: same place and length as the footage, its own speed, in step at alignAt. */
export function retimedSubject(clip: Clip, layer: ReadyLayer, input: RetimeLayerInput): Pick<Clip, 'sourceStart' | 'playbackRate' | 'speedRamp'> {
  if ([input.speed, input.preset, input.anchors].filter(value => value !== undefined).length !== 1) throw new Error('Give exactly one of speed, preset or anchors.');
  const timing: Pick<Clip, 'playbackRate' | 'speedRamp'> = input.speed !== undefined ? { playbackRate: input.speed, speedRamp: undefined } : { playbackRate: undefined, speedRamp: bakeSpeedRamp(input.preset ? presetAnchors(input.preset) : input.anchors!, clip.duration) };
  validatePlaybackRate({ kind: 'video', duration: clip.duration, ...timing });
  if (timing.speedRamp) validateSpeedRamp({ kind: 'video', duration: clip.duration, speedRamp: timing.speedRamp });
  const end = clip.start + clip.duration, alignAt = input.alignAt ?? clip.start;
  if (alignAt < clip.start - 1e-6 || alignAt > end + 1e-6) throw new Error(`alignAt must be inside clip ${clip.id} (${clip.start.toFixed(2)}–${end.toFixed(2)}s).`);
  const timed = { ...timing, start: clip.start, sourceStart: 0 };
  const sourceStart = sourceTimeAt(clip, alignAt) - span(timed, alignAt - clip.start), total = span(timed, clip.duration), frame = 1 / layer.fps;
  if (sourceStart < layer.start - frame || sourceStart + total > layer.end + frame) {
    const room = layer.end - layer.start, fits = Math.max(.25, Math.floor(room / clip.duration * 100) / 100);
    throw new Error(`At this speed the subject plays source ${sourceStart.toFixed(2)}–${(sourceStart + total).toFixed(2)}s, but the layer masks only ${layer.start.toFixed(2)}–${layer.end.toFixed(2)}s. Keep the retimed range inside the clip: move alignAt, slow it down, or stay at or below ${fits}× on average${total > room ? '' : ' with alignAt nearer the middle'}.`);
  }
  return { sourceStart, ...timing };
}

/** Footage < clean plate (synced, real time) < retimed subject cut-out. */
export function applyRetimeLayer(timeline: Timeline, layers: ReadyLayer[], existing: ExistingStack, plateAssetId: string, input: RetimeLayerInput, newId: () => string): Applied {
  const [layer] = layers, clip = baseClip(timeline, layer, input.clipId);
  for (const other of layers.slice(1)) baseClip(timeline, other, clip.id);
  if (clip.assetId !== layer.sourceAssetId) throw new Error(`Clip ${clip.id} shows a clean plate already (removeObject). In v1 retimeLayer needs the original footage: undo removeObject first.`);
  if (existing.clipIds.length) throw new Error(`Clip ${clip.id} already has Genesis clips (${existing.functions?.join(', ') || 'earlier functions'}). In v1 retimeLayer stands alone on its footage, because those clips copy the original subject in real time. undoLatestEdit them first.`);
  const plate = syncedCopy(clip, newId(), 0, { assetId: plateAssetId });
  let placed = placeStack(timeline, clip, existing, { plate });
  const subjects: string[] = [];
  // Every layer gets the same timing, checked against the narrowest masked range.
  const narrowest = { ...layer, start: Math.max(...layers.map(item => item.start)), end: Math.min(...layers.map(item => item.end)) };
  const timing = retimedSubject(clip, narrowest, input);
  for (const item of layers) {
    const subject: Clip = { ...syncedCopy(clip, newId(), 0, { assetId: item.outputAssetId }), ...timing };
    if (subject.playbackRate === undefined) delete subject.playbackRate;
    if (subject.speedRamp === undefined) delete subject.speedRamp;
    if (sourceEndOf(subject) > item.end + 1 / item.fps) throw new Error('The retimed subject runs past the masked range.');
    placed = placeStack(placed.timeline, clip, { clipIds: [...existing.clipIds, plate.id, ...subjects], subjectClipIds: [...existing.subjectClipIds, ...subjects] }, { subject });
    subjects.push(placed.subject!.id);
  }
  return { timeline: placed.timeline, baseClipId: clip.id, clipIds: [plate.id, ...subjects], subjectClipIds: subjects };
}
