import type { LaneId } from './lanes/types';
import { z } from 'zod';

export const editorEditModeSchema = z.enum(['fast', 'precise']);
export type EditorEditMode = z.infer<typeof editorEditModeSchema>;
export const editorEditModePreferenceSchema = z.enum(['auto', ...editorEditModeSchema.options]);
export type EditorEditModePreference = z.infer<typeof editorEditModePreferenceSchema>;
export const DEFAULT_EDITOR_EDIT_MODE: EditorEditModePreference = 'fast';

/** Explicit builds and final deliveries start Precise; tool execution catches implicit builds. */
export function editorModeForRequest(prompt: string, requested: EditorEditModePreference = 'precise'): EditorEditMode {
  const recreation = /\b(recreat\w*|remake|shot[- ]for[- ]shot|clone)\b|\b(copy|match|replicate)\b.{0,60}\b(reference|video|film|motion)\b/i;
  const build = /\b(build|create|generate|design)\b.{0,60}\b(film|launch|trailer|teaser|motion scene|animation|intro|outro)\b|\bmake\s+(?:(?:a|an|new)\s+|\d+\s*(?:s|sec(?:ond)?s?)[ -]+)+(?:[\w-]+[ -]+){0,3}(?:film|launch|trailer|teaser|scene|animation|intro|outro)\b|\b(from scratch|new film|new motion scene)\b/i;
  const final = /\b(publish|publication|export|final cut|final version|final delivery|ready to post|double[- ]check|full review|full checks)\b/i;
  return requested === 'precise' || recreation.test(prompt) || build.test(prompt) || final.test(prompt) ? 'precise' : 'fast';
}

export const PRECISE_ONLY_TOOLS = new Set(['compareReference', 'compareMotion', 'motionMap', 'checkPacing', 'previewRender', 'planEffects', 'checkSound']);

export function editModeInstructions(mode: EditorEditMode, lane:LaneId='edit') {
  return `# Editing mode: ${mode === 'fast' ? 'Fast' : 'Precise'}
${mode === 'fast' ? `Keep the same model and edit locally. ${lane === 'reel' ? 'For plain talking-head speech cleanup, verify retained ranges, duration, linked audio and caption timing from saved data with inspectTimeline and finish. No per-speech-cut frames or compulsory listening. Sample new/changed caption styling or framing once with getFrames; inspect picture changes such as J/L joins locally. Use getSound only for an uncertain short join or an actual audio concern. Explicit visual requests and unresolved uncertainty still need targeted inspection.' : 'Batch changes, then use getFrames at every changed spot and one frame either side (t - 1/fps, t, t + 1/fps, clamped inside the timeline). Zero rendered checks is never completion.'} Reuse cached context and analysis. No whole-video sweeps, reference comparisons, motion maps, pacing passes, effect review plans or repeated re-checks. Read only a short source window when the edit needs it. Correct a visible defect locally and check only that correction.
For a film or motion scene built from scratch, a reference recreation, a final publish/export request, or an explicit full double-check, call usePreciseMode before studying or building it. This overrides Fast. Do not ask permission.` : `Use the ${lane} lane’s skill pages and finish check. Call finish before reporting completion.`}
Keep mode, cost and method metadata in tool results, out of user-facing replies. Add zero "How it was made", "Mode: Precise", "Edited in Fast/Precise" or cost footers. Explain methods or costs only when the user asks. Report actual results and limitations without claiming checks you did not perform.`;
}
