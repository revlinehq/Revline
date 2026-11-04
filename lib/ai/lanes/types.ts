import type { Timeline } from '../../editor/types';
import type { EditorSkill } from '../skills';

export const LANE_IDS = [
  'edit',
  'motion',
  'recreate',
  'explainer',
  'clip',
  'reel',
] as const;
export type LaneId = (typeof LANE_IDS)[number];
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
export type LaneDefinition = {
  id: LaneId;
  label: string;
  description: string;
  skills: EditorSkill[];
  tools: readonly string[];
  check: (context: LaneCheckContext) => string[];
  instructions: string;
};
export const currentEvidence = (context: LaneCheckContext, tool: string) =>
  context.evidence.filter(
    (item) =>
      item.tool === tool &&
      item.timelineId === context.timelineId &&
      item.fingerprint === context.fingerprint,
  );
