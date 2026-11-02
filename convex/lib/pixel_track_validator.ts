import { v } from 'convex/values';
const box = v.object({ left: v.number(), top: v.number(), right: v.number(), bottom: v.number() });
export const pixelTrackRequestValidator = v.object({ start: v.number(), end: v.number(), time: v.number(), seed: v.union(v.object({ kind: v.literal('point'), x: v.number(), y: v.number() }), v.object({ kind: v.literal('box'), box })) });
const stop = v.object({ time: v.number(), reason: v.union(v.literal('boundary'), v.literal('cut'), v.literal('occluded'), v.literal('out-of-frame'), v.literal('unreliable')) });
export const pixelTrackResultValidator = v.object({ engine: v.literal('opencv-klt-template-v1'), seedTime: v.number(), sourceFps: v.number(), width: v.number(), height: v.number(), samples: v.array(v.object({ frameIndex: v.number(), time: v.number(), x: v.number(), y: v.number(), confidence: v.number(), scale: v.number(), rotation: v.number(), box: v.optional(box) })), backward: stop, forward: stop });
