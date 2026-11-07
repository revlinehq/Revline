import type { LaneDefinition } from '../types';
import { skills } from './skills';
import { ownTools, tools } from './tools';
import { check, warn } from './check';
export const definition: LaneDefinition = {
  id: 'genesis',
  description: 'Masking with Meta SAM 3.1: segment a subject once into a tracked layer, then colour only it, grade, blur, glow or outline it, put a title behind it, remove it, change only its speed, or replace a tracked surface.',
  skills,
  tools,
  ownTools,
  check,
  warn,
  checks: {
    standard: {
      frames: 'changes',
      fullTools: false,
      boundedReads: true,
      instructions: 'Every layer the timeline uses (through layer functions, as a clip or as scene media) must be ready and cover what plays. After the last Genesis edit, getFrames at least one time inside each range that uses a layer (plus one frame either side of each change). finish checks layer status, mask coverage, sync with the footage and that frame evidence.',
    },
    final: {
      frames: 'changes',
      fullTools: false,
      boundedReads: false,
      instructions: 'Full checks for a final export, publish or double-check request: getFrames at the start, middle and end of every Genesis range, including a frame where the subject moves fastest. finish checks layer status, mask coverage, sync with the footage and frame evidence.',
    },
  },
  instructions:
    'Read genesis first (and its page remove, speed or replace before those tools). segment once per subject and clip, poll getLayer until ready, then apply layerEffect, textBehind, removeObject, retimeLayer or replaceSurface with the layerId. One layer serves every function. Inspect the result with getFrames. Never export without explicit user confirmation.',
};
