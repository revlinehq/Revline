import { v } from 'convex/values';
import { EDITOR_MODELS, CLAUDE_EDIT_MODELS, EDITOR_REASONING_EFFORTS, EDITOR_SPEED_MODES } from '../../lib/ai/claude-model';

export const claudeModelChoiceValidator = v.union(...EDITOR_MODELS.map(model => v.literal(model.id)));
// Accept stale IDs at the boundary so policy can return a clear, safe refusal.
export const legacyCompatibleModelChoiceValidator = v.union(claudeModelChoiceValidator,...CLAUDE_EDIT_MODELS.map(model=>v.literal(model.id)));
export const editorReasoningEffortValidator = v.union(...EDITOR_REASONING_EFFORTS.map(effort => v.literal(effort)));
// Saved and incoming strings are normalized before use; new writes use canonical efforts.
export const storedEditorReasoningEffortValidator = v.string();
export const editorSpeedModeValidator = v.union(...EDITOR_SPEED_MODES.map(mode => v.literal(mode)));
export const pinnedClaudeModelValidator = v.object({
  provider: v.union(v.literal('anthropic'), v.literal('gateway'), v.literal('google'), v.literal('openai')),
  modelId: v.string(),
  modelChoice: v.optional(legacyCompatibleModelChoiceValidator),
  reasoningEffort: v.optional(storedEditorReasoningEffortValidator),
  speedMode: v.optional(editorSpeedModeValidator),
});
