import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { ownTools, tools } from './tools';
import { check } from './check';
export const definition: LaneDefinition = {
  id: 'genesis',
  description: 'Masking with Meta SAM 3.1: segment a subject once into a tracked layer, then colour only it, grade, blur, glow or outline it, or put a title behind it.',
  skills,
  tools,
  ownTools,
  check,
  checks: {
    standard: {
      frames: 'changes',
      fullTools: false,
      boundedReads: true,
      instructions: 'Every layer used on the timeline must be ready and cover the clip it is applied to. After the last Genesis edit, getFrames at least one time inside each applied range (plus one frame either side of each change). finish checks layer status, mask coverage, copy sync and that frame evidence.',
    },
    final: {
      frames: 'changes',
      fullTools: false,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: getFrames at the start, middle and end of every Genesis range, including a frame where the subject moves fastest. finish checks layer status, mask coverage, copy sync and frame evidence.',
    },
  },
  instructions:
    'Read genesis first. segment once per subject and clip, poll getLayer until ready, then apply layerEffect or textBehind with the layerId. One layer serves every function. Inspect the result with getFrames. Never export without explicit user confirmation.',
};
