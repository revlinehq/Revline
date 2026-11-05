import { READ_ONLY_TOOLS } from './read-only-tools';
import { ASPECT_RATIOS } from '../editor/types';
/** Continue a larger edit only while tools keep producing verified changes. */
export const EDITOR_SOFT_STEPS = 50;
export const EDITOR_HARD_STEPS = 100;
export const EDITOR_PROGRESS_WINDOW = 5;
const EDITOR_VERIFICATION_STEPS = 8;
type Steps = readonly { content: readonly unknown[] }[];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ids = (value: unknown) => Array.isArray(value) && value.some(id => typeof id === 'string' && id.length > 0);
/** Reading a reference and comparing against it are a recreation's work, not stalling: its study and fix loops keep going. */
const STUDY_TOOLS = new Set(['readFrames', 'compareReference']);
export function hasRecentEditProgress(steps: Steps) {
  return steps.slice(-EDITOR_PROGRESS_WINDOW).some(step => step.content.some(value => {
    const part = record(value);
    if (part.type !== 'tool-result' || part.preliminary || typeof part.toolName !== 'string') return false;
    const wrapper = record(part.output), output = wrapper.type === 'json' ? record(wrapper.value) : wrapper;
    if (STUDY_TOOLS.has(part.toolName)) return wrapper.type !== 'error-text' && output.success !== false;
    if (READ_ONLY_TOOLS.has(part.toolName)) return false;
    if (output.success === false || output.unchanged === true || output.saved !== true && output.staged !== true) return false;
    return Array.isArray(output.changedClips) && output.changedClips.some(clip => typeof record(clip).id === 'string' && String(record(clip).id).length > 0)
      || ids(output.removedClipIds) || ids(output.removedMarkerIds) || ids(output.changedMarkerIds)
      || part.toolName === 'setAspectRatio' && (ASPECT_RATIOS as readonly string[]).includes(String(output.aspectRatio));
  }));
}
export function editStepStopReason(steps: Steps): 'hard_step_limit' | 'no_recent_edit_progress' | null {
  if (steps.length >= EDITOR_HARD_STEPS) return 'hard_step_limit';
  // Finishing checks do not mutate the draft. Give a productive edit a bounded
  // verification tail instead of treating those checks as stalled editing.
  let lastEdit = steps.length - 1;
  while (lastEdit >= 0 && !hasRecentEditProgress([steps[lastEdit]])) lastEdit--;
  const verification = steps.slice(lastEdit + 1);
  if (lastEdit >= 0 && verification.length <= EDITOR_VERIFICATION_STEPS && verification.every(step => {
    const results = step.content.map(record).filter(part => part.type === 'tool-result' || part.type === 'tool-error');
    return results.length > 0 && results.every(part => {
      const wrapper = record(part.output), output = wrapper.type === 'json' ? record(wrapper.value) : wrapper;
      return part.type === 'tool-result' && !part.preliminary && ['inspectTimeline', 'previewRender'].includes(String(part.toolName)) && wrapper.type !== 'error-text' && output.success !== false;
    });
  })) return null;
  if (steps.length >= EDITOR_SOFT_STEPS && !hasRecentEditProgress(steps)) return 'no_recent_edit_progress';
  return null;
}
export const shouldStopEditingSteps = (steps: Steps) => editStepStopReason(steps) !== null;
