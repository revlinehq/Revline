import { z } from 'zod';

export const editorEditModeSchema = z.enum(['fast', 'precise']);
export type EditorEditMode = z.infer<typeof editorEditModeSchema>;
export const editorEditModePreferenceSchema = z.enum(['auto', ...editorEditModeSchema.options]);
export type EditorEditModePreference = z.infer<typeof editorEditModePreferenceSchema>;
export const DEFAULT_EDITOR_EDIT_MODE: EditorEditModePreference = 'fast';

/** Explicit builds and final deliveries start Precise; tool execution catches implicit builds. */
export function editorModeForRequest(prompt: string, requested: EditorEditModePreference = 'precise'): EditorEditMode {
  const recreation = /\b(recreat\w*|remake|shot[- ]for[- ]shot|clone)\b|\b(copy|match|replicate)\b.{0,60}\b(reference|video|film|motion)\b/i;
  const build = /\b(build|create|generate|design)\b.{0,60}\b(film|launch|trailer|teaser|motion scene|animation|explainer|intro|outro)\b|\bmake\s+(?:(?:a|an|new)\s+|\d+\s*(?:s|sec(?:ond)?s?)[ -]+)+(?:[\w-]+[ -]+){0,3}(?:film|launch|trailer|teaser|scene|animation|explainer|intro|outro)\b|\b(from scratch|new film|new motion scene)\b/i;
  const final = /\b(publish|publication|export|final cut|final version|final delivery|ready to post|double[- ]check|full review|full checks)\b/i;
  return requested === 'precise' || recreation.test(prompt) || build.test(prompt) || final.test(prompt) ? 'precise' : 'fast';
}

export const PRECISE_ONLY_TOOLS = new Set(['compareReference', 'compareMotion', 'motionMap', 'checkPacing', 'previewRender', 'planEffects', 'checkSound']);
export const PRECISE_MODE_NOTICE = 'I’m running Precise to give this the full checks.';

export function editModeInstructions(mode: EditorEditMode) {
  return `# Editing mode: ${mode === 'fast' ? 'Fast' : 'Precise'}
${mode === 'fast' ? `Keep the same model and edit locally. Batch changes, then use getFrames at every changed spot and one frame either side (t - 1/fps, t, t + 1/fps, clamped inside the timeline). Zero rendered checks is never completion. Reuse cached context and analysis. No whole-video sweeps, reference comparisons, motion maps, pacing passes, effect review plans or repeated re-checks. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.
For a film or motion scene built from scratch, a reference recreation, a final publish/export request, or an explicit full double-check, call usePreciseMode before studying or building it. This overrides Fast. Do not ask permission.` : `Use the full existing harness: inventory, dense reference reads, transition compares at 15 fps, compareReference, compareMotion, checkPacing, effect and sound checks, and the inventory close-out as applicable. Follow scene-engine edit-lanes and the matching skills.`}
The application appends the actual mode to edit results and ends Fast results with "Precise can double-check it." Do not duplicate that footer or claim checks you did not perform. For MCP clients, include that mode line yourself. Questions and small talk need no mode footer.`;
}
