'use client';

import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { FREE_EDITOR_MODEL_CHOICE, type ClaudeModelChoice } from '@/lib/ai/claude-model';

/** What the server tells this user's composer about their plan and its models. */
export type ComposerSettings = Partial<Omit<FunctionReturnType<typeof api.assistant.composerSettings>, 'allowedModels' | 'catalogModels' | 'defaultModelChoice'>> & { catalogModels?: readonly ClaudeModelChoice[]; allowedModels?: readonly ClaudeModelChoice[]; defaultModelChoice?: ClaudeModelChoice };

/**
 * What a message asks the server for. The composer has no model or effort picker: the server chooses both.
 * A plan without paid model access still names the free model and low effort, as it always has.
 */
export function assistantRequest(settings: ComposerSettings): { modelChoice?: ClaudeModelChoice; reasoningEffort?: 'low' } {
  return settings.paidModelAccess !== true ? { modelChoice: FREE_EDITOR_MODEL_CHOICE, reasoningEffort: 'low' } : {};
}
