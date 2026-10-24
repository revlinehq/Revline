import type { ClaudeModelSelection } from './claude-model';

type ModelPolicyEnvironment = Readonly<Record<string, string | undefined>>;
// Keep the export name compatible with existing clients: the GPT editing models.
export const PRODUCTION_CLAUDE_MODEL_CHOICES = ['gpt-6.1-sol', 'gpt-6-astra'] as const;
/** Claude editing models, offered when ANTHROPIC_API_KEY is configured. */
export const ANTHROPIC_EDIT_CHOICES = ['sonnet', 'opus'] as const;
const ANTHROPIC_EDIT_MODEL_IDS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
export const GPT_ONLY_EDITING_ERROR = 'Revline editing supports GPT-6.1 Sol, GPT-6 Astra, Sonnet 5.5 and Opus 5.5. Choose a supported model.';

export function allowedClaudeModelChoices(env: ModelPolicyEnvironment = process.env): readonly ((typeof PRODUCTION_CLAUDE_MODEL_CHOICES)[number] | (typeof ANTHROPIC_EDIT_CHOICES)[number])[] {
  return env.ANTHROPIC_API_KEY?.trim() ? [...PRODUCTION_CLAUDE_MODEL_CHOICES, ...ANTHROPIC_EDIT_CHOICES] : PRODUCTION_CLAUDE_MODEL_CHOICES;
}

export function enforceClaudeModelPolicy(selection: ClaudeModelSelection, env: ModelPolicyEnvironment = process.env): ClaudeModelSelection {
  const choice = selection.modelChoice;
  if (selection.provider === 'openai') {
    if (!PRODUCTION_CLAUDE_MODEL_CHOICES.some(item => item === selection.modelId) || (choice !== undefined && !PRODUCTION_CLAUDE_MODEL_CHOICES.some(item => item === choice))) throw new Error(GPT_ONLY_EDITING_ERROR);
    if (!env.OPENAI_API_KEY?.trim()) throw new Error('OpenAI editing requires OPENAI_API_KEY in this Convex environment. Configure the backend key before editing.');
    return selection;
  }
  if (selection.provider === 'anthropic') {
    if (!ANTHROPIC_EDIT_MODEL_IDS.includes(selection.modelId) || (choice !== undefined && !ANTHROPIC_EDIT_CHOICES.some(item => item === choice))) throw new Error(GPT_ONLY_EDITING_ERROR);
    if (!env.ANTHROPIC_API_KEY?.trim()) throw new Error('Claude editing requires ANTHROPIC_API_KEY in this Convex environment.');
    return selection;
  }
  throw new Error(GPT_ONLY_EDITING_ERROR);
}
