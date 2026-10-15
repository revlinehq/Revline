import { v } from 'convex/values';
import { EDITOR_MODELS } from '../../lib/ai/claude-model';

export const claudeModelChoiceValidator = v.union(...EDITOR_MODELS.map(model => v.literal(model.id)));
export const pinnedClaudeModelValidator = v.object({
  provider: v.union(v.literal('anthropic'), v.literal('gateway'), v.literal('openai')),
  modelId: v.string(),
  modelChoice: v.optional(claudeModelChoiceValidator),
});
