import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import { enforceClaudeModelPolicy } from './claude-model-policy';

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
    return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? selected.gatewayModelId : selected.modelId, modelChoice }, env);
  }
  return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? env.CLAUDE_GATEWAY_MODEL ?? CLAUDE_GATEWAY_MODEL : env.CLAUDE_MODEL ?? CLAUDE_MODEL }, env);
}

export function validatePinnedClaudeModel(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (selection.modelChoice !== undefined) {
    const selected = CLAUDE_EDIT_MODELS.find(model => model.id === selection.modelChoice);
    if (!selected || selection.modelId !== (selection.provider === 'gateway' ? selected.gatewayModelId : selected.modelId)) throw new Error('Pinned editor model does not match its selection.');
  }
  return enforceClaudeModelPolicy(selection, env);
}

export function claudeProviderOptions(modelId: string) {
  if (!/^(?:anthropic\/)?claude-(?:haiku|sonnet|opus)-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    cacheControl: { type: 'ephemeral', ttl: '5m' },
    effort: 'medium',
    thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}
