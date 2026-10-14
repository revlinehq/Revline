import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_GATEWAY_MODEL = 'anthropic/claude-sonnet-5.5';

export const CLAUDE_EDIT_MODELS = [
  { id: 'haiku', label: 'Haiku 5.5', modelId: 'claude-haiku-5-5', gatewayModelId: 'anthropic/claude-haiku-5.5' },
  { id: 'sonnet', label: 'Sonnet 5.5', modelId: CLAUDE_MODEL, gatewayModelId: CLAUDE_GATEWAY_MODEL },
  { id: 'opus', label: 'Opus 5.5', modelId: 'claude-opus-5-5', gatewayModelId: 'anthropic/claude-opus-5.5' },
] as const;
export type ClaudeModelChoice = typeof CLAUDE_EDIT_MODELS[number]['id'];
export type ClaudeModelSelection = { provider: 'anthropic' | 'gateway'; modelId: string; modelChoice?: ClaudeModelChoice };
type ClaudeModelEnvironment = Readonly<Record<string, string | undefined>>;

export function claudeModelSwitcherEnabled(env: ClaudeModelEnvironment = process.env) {
  return env.MODEL_SWITCHER_ENABLED === 'true';
}

export function resolveClaudeModel(modelChoice?: ClaudeModelChoice, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  const provider = env.AI_GATEWAY_ENABLED === 'true' ? 'gateway' : 'anthropic';
  if (modelChoice !== undefined) {
    if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual model selection is currently disabled.');
    const selected = CLAUDE_EDIT_MODELS.find(model => model.id === modelChoice);
    if (!selected) throw new Error('Choose a supported editor model.');
    return { provider, modelId: provider === 'gateway' ? selected.gatewayModelId : selected.modelId, modelChoice };
  }
  return { provider, modelId: provider === 'gateway' ? env.CLAUDE_GATEWAY_MODEL ?? CLAUDE_GATEWAY_MODEL : env.CLAUDE_MODEL ?? CLAUDE_MODEL };
}

export function validatePinnedClaudeModel(selection: ClaudeModelSelection): ClaudeModelSelection {
  if (selection.modelChoice !== undefined) {
    const selected = CLAUDE_EDIT_MODELS.find(model => model.id === selection.modelChoice);
    if (!selected || selection.modelId !== (selection.provider === 'gateway' ? selected.gatewayModelId : selected.modelId)) throw new Error('Pinned editor model does not match its selection.');
  }
  return selection;
}

export function claudeProviderOptions(modelId: string) {
  if (!/^(?:anthropic\/)?claude-(?:haiku|sonnet|opus)-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    effort: 'medium',
    thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}
