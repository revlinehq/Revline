import { v } from 'convex/values';
import { CLAUDE_EDIT_MODELS } from '../../lib/ai/claude-model';

export const claudeModelChoiceValidator = v.union(...CLAUDE_EDIT_MODELS.map(model => v.literal(model.id)));
export const pinnedClaudeModelValidator = v.object({
  provider: v.union(v.literal('anthropic'), v.literal('gateway')),
  modelId: v.string(),
  modelChoice: v.optional(claudeModelChoiceValidator),
});
