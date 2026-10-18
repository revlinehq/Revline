import type { ClaudeModelSelection } from './claude-model';

type ModelPolicyEnvironment = Readonly<Record<string, string | undefined>>;
// Keep the export name compatible with existing clients; active editing is GPT-only.
export const PRODUCTION_CLAUDE_MODEL_CHOICES = ['gpt-6.1-sol', 'gpt-6-astra'] as const;
export const GPT_ONLY_EDITING_ERROR = 'Revline editing supports GPT-6.1 Sol and GPT-6 Astra only. Choose a supported GPT model.';

export function allowedClaudeModelChoices(_env: ModelPolicyEnvironment = process.env): readonly (typeof PRODUCTION_CLAUDE_MODEL_CHOICES)[number][] {
  return PRODUCTION_CLAUDE_MODEL_CHOICES;
}

export function enforceClaudeModelPolicy(selection: ClaudeModelSelection, env: ModelPolicyEnvironment = process.env): ClaudeModelSelection {
  if (selection.provider !== 'openai' || !PRODUCTION_CLAUDE_MODEL_CHOICES.some(choice=>choice===selection.modelId) || (selection.modelChoice !== undefined && !PRODUCTION_CLAUDE_MODEL_CHOICES.some(choice=>choice===selection.modelChoice))) throw new Error(GPT_ONLY_EDITING_ERROR);
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('OpenAI editing requires OPENAI_API_KEY in this Convex environment. Configure the backend key before editing.');
  return selection;
}
