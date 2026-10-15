import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { enforceClaudeModelPolicy } from './claude-model-policy';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_GATEWAY_MODEL = 'anthropic/claude-sonnet-5.5';

export const CLAUDE_EDIT_MODELS = [
  { id: 'haiku', label: 'Haiku 5.5', modelId: 'claude-haiku-5-5', gatewayModelId: 'anthropic/claude-haiku-5.5' },
  { id: 'sonnet', label: 'Sonnet 5.5', modelId: CLAUDE_MODEL, gatewayModelId: CLAUDE_GATEWAY_MODEL },
  { id: 'opus', label: 'Opus 5.5', modelId: 'claude-opus-5-5', gatewayModelId: 'anthropic/claude-opus-5.5' },
] as const;
// Native OpenAI Standard rates, USD / 1M tokens, verified 2026-10-15.
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-6-astra
// Above 272K input tokens the full request uses 2x input/cache and 1.5x output.
export const OPENAI_EDIT_MODELS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', modelId: 'gpt-6.1-sol', pricing: { input: 2, cacheRead: .10, cacheWrite: 2.50, output: 10 } },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', modelId: 'gpt-6-astra', pricing: { input: 10, cacheRead: 1, cacheWrite: 12.50, output: 50 } },
] as const;
export const EDITOR_MODELS = [...CLAUDE_EDIT_MODELS, ...OPENAI_EDIT_MODELS] as const;
export type ClaudeModelChoice = typeof EDITOR_MODELS[number]['id'];
export type ClaudeModelSelection = { provider: 'anthropic' | 'gateway' | 'openai'; modelId: string; modelChoice?: ClaudeModelChoice };
type ClaudeModelEnvironment = Readonly<Record<string, string | undefined>>;

export function claudeModelSwitcherEnabled(env: ClaudeModelEnvironment = process.env) {
  return env.MODEL_SWITCHER_ENABLED === 'true';
}

export function resolveClaudeModel(modelChoice?: ClaudeModelChoice, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  const provider = env.AI_GATEWAY_ENABLED === 'true' ? 'gateway' : 'anthropic';
  if (modelChoice !== undefined) {
    if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual model selection is currently disabled.');
    const openai = OPENAI_EDIT_MODELS.find(model => model.id === modelChoice);
    if (openai) return enforceClaudeModelPolicy({ provider: 'openai', modelId: openai.modelId, modelChoice }, env);
    const selected = CLAUDE_EDIT_MODELS.find(model => model.id === modelChoice);
    if (!selected) throw new Error('Choose a supported editor model.');
    return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? selected.gatewayModelId : selected.modelId, modelChoice }, env);
  }
  return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? env.CLAUDE_GATEWAY_MODEL ?? CLAUDE_GATEWAY_MODEL : env.CLAUDE_MODEL ?? CLAUDE_MODEL }, env);
}

export function validatePinnedClaudeModel(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  const openai = OPENAI_EDIT_MODELS.find(model => model.modelId === selection.modelId);
  if (selection.provider === 'openai') {
    if (!openai || (selection.modelChoice !== undefined && selection.modelChoice !== openai.id)) throw new Error('Pinned editor model does not match its selection.');
    return enforceClaudeModelPolicy(selection, env);
  }
  if (openai) throw new Error('Pinned editor model does not match its provider.');
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
    ...(modelId==='claude-sonnet-5-5'?{speed:'standard',serviceTier:'standard_only',inferenceGeo:'global'} as const:{}),
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}

export function editorProviderOptions(selection: ClaudeModelSelection) {
  if (selection.provider !== 'openai') return claudeProviderOptions(selection.modelId);
  const openai = {
    reasoningEffort: 'medium', reasoningMode: 'standard', serviceTier: 'default',
    // History is managed by the existing Agent thread; retain encrypted reasoning
    // in its messages rather than relying on provider-side conversation storage.
    store: false, include: ['reasoning.encrypted_content'],
    promptCacheOptions: { ttl: '30m' },
  } satisfies OpenAIResponsesProviderOptions;
  return { openai };
}

export function assertEditorModelConfigured(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env) {
  if (selection.provider === 'openai' && !env.OPENAI_API_KEY?.trim()) throw new Error('OpenAI editing requires OPENAI_API_KEY in this Convex environment. Choose Sonnet or configure the backend key.');
  if (selection.provider === 'anthropic' && !env.ANTHROPIC_API_KEY?.trim()) throw new Error('Claude editing requires ANTHROPIC_API_KEY in this Convex environment.');
  // A captured gateway selection remains pinned even if its selection flag changes.
}
