import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const EVIDENCE_ENTRIES = 120, EVIDENCE_BYTES = 650_000;

/** One bounded writer for task evidence: a newer entry replaces the same tool, timeline and input. */
export async function saveEvidence(ctx: MutationCtx, row: Doc<'editingLaneTasks'>, entry: Doc<'editingLaneTasks'>['evidence'][number]) {
  const previous = row.evidence.filter(
    (item) =>
      item.timelineId !== entry.timelineId ||
      item.tool !== entry.tool ||
      JSON.stringify(item.input) !== JSON.stringify(entry.input),
  );
  const evidence = [...previous, entry].slice(-EVIDENCE_ENTRIES);
  while (
    evidence.length > 1 &&
    new TextEncoder().encode(JSON.stringify(evidence)).length > EVIDENCE_BYTES
  )
    evidence.shift();
  if (new TextEncoder().encode(JSON.stringify(evidence)).length > EVIDENCE_BYTES)
    throw new ConvexError(
      'Check output is too large to retain. Check shorter contiguous windows.',
    );
  await ctx.db.patch(row._id, { evidence });
}
