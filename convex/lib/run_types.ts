import type { Doc, Id } from '../_generated/dataModel';

// Leaf types shared by the editor toolkit, lane finish and save receipts, kept here so those modules do not import each other.

/** The run a toolkit's tool calls belong to. */
export type EditorRun = { projectId: Id<'projects'>; ownerId: string; runId: string };
export type LaneTask = Doc<'editingLaneTasks'>;
