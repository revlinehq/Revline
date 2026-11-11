import type { Timeline } from '../../editor/types';
import type { EditorSkill } from '../skills/types';
import type { EyesPolicy } from '../eyes';

export const LANE_IDS = [
  'edit',
  'clip',
  'reel',
] as const;
// Legacy stored lane values remain readable without becoming selectable.
export type LaneId = (typeof LANE_IDS)[number] | 'explainer' | 'motion' | 'recreate';
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
};
/** `final` is the one automatic step-up, set by the server from the request. Model and effort never change the level. */
export type CheckLevel = 'standard' | 'final';
/** What a lane checks while editing and at finish. */
export type CheckRecipe = {
  /**
   * changes: finish draws a few frames of what changed (cuts, overlays, one caption sample), on a hard budget.
   * sample: saved-data checks; finish draws at most three frames on a plain reel timeline.
   * data: saved-data delivery checks (finishClipping).
   * Every recipe except data and sample also renders each changed range at finish.
   */
  frames: 'changes' | 'sample' | 'data';
  /** Pacing, sound-sync and effect-review tools. */
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
  description: string;
  skills: EditorSkill[];
  tools: readonly string[];
  check: (context: LaneCheckContext) => string[];
  /** Advisory findings reported with finish; they never block it. */
  warn?: (context: LaneCheckContext) => string[];
  checks: Record<CheckLevel, CheckRecipe>;
  /** What this lane's eyes examine (lib/ai/eyes): spots, flags, frame budget, what fails finish. Lanes without one keep their getFrames rules. */
  eyes?: EyesPolicy;
  instructions: string;
};
export const currentEvidence = (context: LaneCheckContext, tool: string) =>
  context.evidence.filter(
    (item) =>
      item.tool === tool &&
      item.timelineId === context.timelineId &&
      item.fingerprint === context.fingerprint,
  );
