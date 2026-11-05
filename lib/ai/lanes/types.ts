import type { Timeline } from '../../editor/types';
import type { EditorSkill } from '../skills';
import type { MotionCheck, MotionOff, MotionWindow } from '../motion-coverage';

export const LANE_IDS = [
  'edit',
  'motion',
  'recreate',
  'clip',
  'reel',
] as const;
// Legacy stored lane values remain readable without becoming selectable.
export type LaneId = (typeof LANE_IDS)[number] | 'explainer';
export type LaneEvidence = {
  tool: string;
  timelineId: string;
  fingerprint: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};
export type LaneCheckContext = {
  timeline: Timeline;
  evidence: LaneEvidence[];
  fingerprint: string;
  timelineId: string;
  assets: { _id: string; kind: string; duration?: number }[];
  referenceMotion?: ReferenceMotionEvidence[];
};
export type ReferenceMotionEvidence = {
  projectId: string;
  assetId: string;
  start: number;
  end: number;
  offset: number;
  referenceDuration?: number;
  revision: number;
  timelineKey: string;
  windows: MotionWindow[];
  checks: MotionCheck[];
  off: MotionOff[];
};
/** `final` is the one automatic step-up, set by the server from the request. Model and effort never change the level. */
export type CheckLevel = 'standard' | 'final';
/** What a lane checks while editing and at finish. */
export type CheckRecipe = {
  /**
   * changes: getFrames at each change and one frame either side.
   * sample: saved-data checks, plus one getFrames sample of new styling or framing on plain reel timelines.
   * data: saved-data delivery checks (finishClipping).
   * full: the lane's own full checklist (motion, recreate); no pending frame queue.
   * Every recipe except data and sample also renders each changed range at finish.
   */
  frames: 'changes' | 'sample' | 'data' | 'full';
  /** Pacing, sound-sync, motion-map, effect-review and reference-comparison tools, and the scene guard render. */
  fullTools: boolean;
  /** readFrames stays inside short named source windows: no whole-video sweeps. */
  boundedReads: boolean;
  /** Clip QA that finish requires on every accepted tab. */
  clipQa?: readonly ('framing' | 'decode-health')[];
  /** What the agent is told to check. */
  instructions: string;
};
export type LaneDefinition = {
  id: LaneId;
  label: string;
  description: string;
  skills: EditorSkill[];
  tools: readonly string[];
  check: (context: LaneCheckContext) => string[];
  checks: Record<CheckLevel, CheckRecipe>;
  instructions: string;
  referenceMotion?: 'required' | 'bound';
};
export const currentEvidence = (context: LaneCheckContext, tool: string) =>
  context.evidence.filter(
    (item) =>
      item.tool === tool &&
      item.timelineId === context.timelineId &&
      item.fingerprint === context.fingerprint,
  );
