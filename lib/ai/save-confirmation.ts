import { READ_ONLY_TOOLS } from './read-only-tools';

/** These tools persist outside the timeline and confirm through their own result. */
export const SAVED_ELSEWHERE = new Set(['remember', 'forget', 'createBrandKit', 'updateBrandKit', 'saveBlueprint']);

export function needsSaveConfirmation(name: string) {
  return !READ_ONLY_TOOLS.has(name) && !SAVED_ELSEWHERE.has(name);
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
