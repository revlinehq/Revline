import { v } from 'convex/values';
import { EDITOR_MODELS, CLAUDE_EDIT_MODELS, EDITOR_REASONING_EFFORTS, EDITOR_SPEED_MODES, RETIRED_EDITOR_MODEL_CHOICES } from '../../lib/ai/claude-model';

export const claudeModelChoiceValidator = v.union(...EDITOR_MODELS.map(model => v.literal(model.id)));
// Accept stale IDs at the boundary: retired ones (Gemini 4 Argon, GPT-6 Astra) in queued turns and old clients fall back to the default model.
export const legacyCompatibleModelChoiceValidator = v.union(claudeModelChoiceValidator,...CLAUDE_EDIT_MODELS.map(model=>v.literal(model.id)),...RETIRED_EDITOR_MODEL_CHOICES.map(id=>v.literal(id)));
export const editorReasoningEffortValidator = v.union(...EDITOR_REASONING_EFFORTS.map(effort => v.literal(effort)));
// Saved and incoming strings are normalized before use; new writes use canonical efforts.
export const storedEditorReasoningEffortValidator = v.string();
export const editorSpeedModeValidator = v.union(...EDITOR_SPEED_MODES.map(mode => v.literal(mode)));
export const pinnedClaudeModelValidator = v.object({
  // 'google' only appears on turns queued with the retired Gemini 4 Argon; validatePinnedClaudeModel moves them to the default.
  provider: v.union(v.literal('anthropic'), v.literal('gateway'), v.literal('google'), v.literal('openai')),
  modelId: v.string(),
  modelChoice: v.optional(legacyCompatibleModelChoiceValidator),
  reasoningEffort: v.optional(storedEditorReasoningEffortValidator),
  speedMode: v.optional(editorSpeedModeValidator),
});
