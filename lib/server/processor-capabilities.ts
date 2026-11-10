/** What a media processor can do, as a list it reports when it signs in to the queue (next to
 *  MEDIA_PROCESSOR_VERSION). Convex stores the last report per processor backend and asks
 *  `processorCan(ctx, 'read:looks')` before depending on anything gated.
 *
 *  Why: Convex and the processor are released separately, so new Convex code can meet an older processor.
 *  An older processor answers an unknown read mode with an ordinary, empty "success".
 *
 *  Adding a read mode or task kind: put it in the GATED list here, guard its Convex caller with
 *  `processorCan` and degrade when it is absent. `scripts/compat-check.mjs` fails a pull request that
 *  adds one without both. Pure module: Convex, the worker and scripts all import it. */

/** Bump when the shape of the report changes (not when a capability is added). */
export const PROCESSOR_CAPABILITIES_VERSION = 1;

/** Shipped before processors reported anything: every deployed processor has these, so they are never checked. */
export const BASELINE_READ_MODES = ['sheet', 'track', 'measure', 'compare', 'trace', 'font', 'sounds', 'motion'] as const;
export const BASELINE_TASK_KINDS = ['highlights', 'transcribe', 'understand', 'shots', 'beats', 'track', 'frames', 'video', 'reference', 'facecam', 'speakers',
  'extract', 'preview', 'waveform', 'render', 'import', 'review', 'snapshot', 'cutout', 'derive', 'blueprint', 'read'] as const;

/** Added since. A deployed processor may not have these: Convex checks `processorCan` first. */
export const GATED_READ_MODES = ['looks'] as const;
export const GATED_TASK_KINDS = [] as const;

export type ProcessorReadMode = (typeof BASELINE_READ_MODES)[number] | (typeof GATED_READ_MODES)[number];
export type ProcessorTaskKind = (typeof BASELINE_TASK_KINDS)[number] | (typeof GATED_TASK_KINDS)[number];
export type ProcessorCapability = `read:${ProcessorReadMode}` | `kind:${ProcessorTaskKind}`;

const ids = (prefix: 'read' | 'kind', names: readonly string[]) => names.map(name => `${prefix}:${name}`);
const BASELINE: readonly string[] = [...ids('read', BASELINE_READ_MODES), ...ids('kind', BASELINE_TASK_KINDS)];
/** Everything this code's processor can do: what it reports at sign-in. */
export const PROCESSOR_CAPABILITIES = [...BASELINE, ...ids('read', GATED_READ_MODES), ...ids('kind', GATED_TASK_KINDS)] as ProcessorCapability[];
export const isBaselineCapability = (capability: string) => BASELINE.includes(capability);
