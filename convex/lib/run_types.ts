import type { Doc, Id } from '../_generated/dataModel';

// Leaf types shared by the editor toolkit, lane finish and save receipts, kept here so those modules do not import each other.

/** The run a toolkit's tool calls belong to. */
export type EditorRun = { projectId: Id<'projects'>; ownerId: string; runId: string };
export type LaneTask = Doc<'editingLaneTasks'>;
/** A task read for tool calls (lanes:taskFields): its small fields, which tabs have a baseline, and only the evidence
 * entries the reader named. The full row (lanes:task) carries up to 650 KB of check evidence. */
export type LaneTaskFields = Omit<LaneTask, 'evidence' | 'baselines'> & { evidence: LaneTask['evidence']; baselineTimelineIds: string[] };
