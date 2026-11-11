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
export const BASELINE_READ_MODES = ['sheet'] as const;
export const BASELINE_TASK_KINDS = ['highlights', 'transcribe', 'understand', 'shots', 'beats', 'track', 'frames', 'video', 'facecam', 'speakers',
  'extract', 'preview', 'waveform', 'render', 'import', 'review', 'snapshot', 'cutout', 'derive', 'read'] as const;

/** Added since. A deployed processor may not have these: Convex checks `processorCan` first. */
export const GATED_READ_MODES = ['looks'] as const;
export const GATED_TASK_KINDS = [] as const;
/** Links the first importer did not read (it knew YouTube, Twitch VODs, Kick, X and MP4 files). An older processor
 *  would download their page as a file and fail, so Convex refuses them with a plain message until one reports these. */
export const GATED_IMPORT_SOURCES = ['twitch-clips', 'more-sites'] as const;
/** What the renderer draws that an older image cannot. 'emoji': colour emoji in text (the image has no emoji font, and
 *  the bundled one arrived later), so frames and exports from an older processor show a "NO GLYPH" box instead.
 *  'fonts-2': the text fonts added with caption presets (Bangers, Outfit, Rubik, Figtree, more Poppins weights); Convex
 *  sends an older processor each of those as the older font it names in lib/editor/text-fonts.ts, since that processor
 *  rejects a font it does not know. 'caption-presets': the word-by-word motion of caption presets
 *  (lib/editor/caption-preset-text.tsx); an older processor gets the preset's static look. */
export const GATED_RENDER_FEATURES = ['emoji', 'fonts-2', 'caption-presets'] as const;

/** Removed with the motion and recreate lanes. Stored rows may still name them, so the schema keeps them; no processor
 *  runs or reports them, and nothing queues them. */
export const RETIRED_READ_MODES = ['track', 'measure', 'compare', 'trace', 'font', 'sounds', 'motion'] as const;
export const RETIRED_TASK_KINDS = ['reference', 'blueprint'] as const;

export type ProcessorReadMode = (typeof BASELINE_READ_MODES)[number] | (typeof GATED_READ_MODES)[number] | (typeof RETIRED_READ_MODES)[number];
export type ProcessorTaskKind = (typeof BASELINE_TASK_KINDS)[number] | (typeof GATED_TASK_KINDS)[number] | (typeof RETIRED_TASK_KINDS)[number];
export type ProcessorCapability = `read:${ProcessorReadMode}` | `kind:${ProcessorTaskKind}` | `import:${(typeof GATED_IMPORT_SOURCES)[number]}` | `render:${(typeof GATED_RENDER_FEATURES)[number]}`;

const ids = (prefix: 'read' | 'kind' | 'import' | 'render', names: readonly string[]) => names.map(name => `${prefix}:${name}`);
const BASELINE: readonly string[] = [...ids('read', BASELINE_READ_MODES), ...ids('kind', BASELINE_TASK_KINDS)];
/** Everything this code's processor can do: what it reports at sign-in. */
export const PROCESSOR_CAPABILITIES = [...BASELINE, ...ids('read', GATED_READ_MODES), ...ids('kind', GATED_TASK_KINDS), ...ids('import', GATED_IMPORT_SOURCES), ...ids('render', GATED_RENDER_FEATURES)] as ProcessorCapability[];
export const isBaselineCapability = (capability: string) => BASELINE.includes(capability);
