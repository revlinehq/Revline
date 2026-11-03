import type { LaneCheckContext } from '../types';
// Structural validation, new gaps and changed-range rendering run in the shared finish executor.
export const check = (_context: LaneCheckContext): string[] => [];
