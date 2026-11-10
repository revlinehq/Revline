import type { Infer } from 'convex/values';
import { internal } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { mediaTaskKind, referenceReadMode } from '../schema';
import { processorBackend } from './processor_backend';
import { isBaselineCapability, type ProcessorCapability, type ProcessorReadMode, type ProcessorTaskKind } from '../../lib/server/processor-capabilities';

// tsc fails on this line when referenceReadMode or mediaTaskKind gains a member the manifest does not list:
// add it to GATED_READ_MODES / GATED_TASK_KINDS in lib/server/processor-capabilities.ts and guard its caller with processorCan.
type Unlisted = Exclude<Infer<typeof referenceReadMode>, ProcessorReadMode> | Exclude<Infer<typeof mediaTaskKind>, ProcessorTaskKind>;
export const MANIFEST_COVERS_CONTRACT: [Unlisted] extends [never] ? true : never = true;

/** The last sign-in report of the active backend's processor; null when none has ever reported. */
export async function reportedCapabilities(ctx: QueryCtx | MutationCtx): Promise<string[] | null> {
  return (await ctx.db.query('processorReports').withIndex('by_backend', q => q.eq('backend', processorBackend())).unique())?.capabilities ?? null;
}

/** Whether the deployed media processor can do this. Check it before depending on a gated capability, and degrade
 *  when it is false. Baseline capabilities are always true; a gated one only when the processor reported it.
 *  A backend whose processor has never reported (an image from before reporting) answers `whenUnreported`: false
 *  by default; pass true only when the caller can tell from the result that the processor did not do the work.
 *  Known limit: the report is the last sign-in for the backend, so a mixed fleet during a rollout, or a rollback to
 *  an image from before reporting, can leave it stale. Callers keep a result-level fallback for that. */
export async function processorCan(ctx: QueryCtx | MutationCtx | ActionCtx, capability: ProcessorCapability, { whenUnreported = false } = {}): Promise<boolean> {
  if (isBaselineCapability(capability)) return true;
  const reported: string[] | null = 'db' in ctx ? await reportedCapabilities(ctx) : await ctx.runQuery(internal.mediaProcessor.capabilities, {});
  return reported ? reported.includes(capability) : whenUnreported;
}
