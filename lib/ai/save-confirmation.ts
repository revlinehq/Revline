import { z } from 'zod';
import { EDITOR_TOOL_DEFINITIONS, toolBehavior } from './tool-definitions';

const revision = z.number().int().nonnegative();
const toolSaveReceiptSchema = z.union([
  z.object({ kind: z.literal('timeline'), status: z.enum(['saved', 'staged', 'unchanged']), revision }),
  z.object({ kind: z.literal('resource'), status: z.enum(['saved', 'unchanged']), revision }),
  z.object({ kind: z.literal('job'), status: z.enum(['queued', 'unchanged']), revision }),
  z.object({ kind: z.enum(['timeline', 'resource', 'job']), status: z.literal('failed'), revision, message: z.string() }),
  z.object({ kind: z.enum(['timeline', 'resource', 'job']), status: z.literal('interrupted'), revision, message: z.string() }),
]);
export type ToolSaveReceipt = z.infer<typeof toolSaveReceiptSchema>;
export function toolSaveReceipt(output: { saveReceipt?: unknown } | undefined) {
  const parsed = toolSaveReceiptSchema.safeParse(output?.saveReceipt);
  return parsed.success ? parsed.data : undefined;
}

/** These tools persist outside the timeline and confirm through their own result. */
export const SAVED_ELSEWHERE = new Set<string>(Object.entries(EDITOR_TOOL_DEFINITIONS).filter(([, definition]) => definition.effect === 'resource').map(([name]) => name));

export function needsSaveConfirmation(name: string) {
  const effect = toolBehavior(name)?.effect;
  return effect === 'timeline' || effect === 'job';
}

export function hasSaveEvidence(output: { saved?: unknown; unchanged?: unknown } | undefined) {
  return output?.saved === true || output?.unchanged === true;
}

/** Terminal staged results are confirmed only by the publication for their exact base revision. */
export function terminalSaveCondition(step: { staged: boolean; stagedRevision?: number }, publication?: { status: 'saved' | 'failed' | 'aborted'; stagedRevision: number; revision?: number }) {
  if (!step.staged) return 'missing_save_evidence';
  if (step.stagedRevision === undefined) return 'staged_revision_missing';
  if (!publication) return 'staged_without_receipt';
  if (step.stagedRevision !== publication.stagedRevision) return 'staged_receipt_mismatch';
  // Matching failure receipts have the distinct "Not saved" card.
  if (publication.status !== 'saved' || publication.revision === publication.stagedRevision + 1) return null;
  return 'staged_receipt_mismatch';
}
