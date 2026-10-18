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
export const OPENAI_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORTS[number];
export const OPENAI_SPEED_MODES = ['standard', 'fast'] as const;
export type OpenAISpeedMode = typeof OPENAI_SPEED_MODES[number];
export type ClaudeModelChoice = typeof EDITOR_MODELS[number]['id'];
export type ClaudeModelSelection = { provider: 'anthropic' | 'gateway' | 'openai'; modelId: string; modelChoice?: ClaudeModelChoice; reasoningEffort?: OpenAIReasoningEffort; speedMode?: OpenAISpeedMode };
type ClaudeModelEnvironment = Readonly<Record<string, string | undefined>>;

export function claudeModelSwitcherEnabled(env: ClaudeModelEnvironment = process.env) {
  return env.MODEL_SWITCHER_ENABLED === 'true';
}

export function resolveClaudeModel(modelChoice?: ClaudeModelChoice, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  const provider = env.AI_GATEWAY_ENABLED === 'true' ? 'gateway' : 'anthropic';
  const choice=modelChoice??(env.EDITOR_DEFAULT_MODEL?.trim()||undefined);
  if (choice !== undefined) {
    if (modelChoice!==undefined&&!claudeModelSwitcherEnabled(env)) throw new Error('Manual model selection is currently disabled.');
    const openai = OPENAI_EDIT_MODELS.find(model => model.id === choice);
    if (openai) return enforceClaudeModelPolicy({ provider: 'openai', modelId: openai.modelId, modelChoice:openai.id }, env);
    const selected = CLAUDE_EDIT_MODELS.find(model => model.id === choice);
    if (!selected) throw new Error(modelChoice===undefined?'Configure a supported EDITOR_DEFAULT_MODEL default.':'Choose a supported editor model.');
    return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? selected.gatewayModelId : selected.modelId, modelChoice:selected.id }, env);
  }
  return enforceClaudeModelPolicy({ provider, modelId: provider === 'gateway' ? env.CLAUDE_GATEWAY_MODEL ?? CLAUDE_GATEWAY_MODEL : env.CLAUDE_MODEL ?? CLAUDE_MODEL }, env);
}

export function defaultEditorModelChoice(env:ClaudeModelEnvironment=process.env):ClaudeModelChoice|undefined {
  const selected=resolveClaudeModel(undefined,env);
  return EDITOR_MODELS.find(model=>model.modelId===selected.modelId||('gatewayModelId' in model&&model.gatewayModelId===selected.modelId))?.id;
}

export function validatePinnedClaudeModel(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (selection.reasoningEffort !== undefined && (selection.provider !== 'openai' || !OPENAI_REASONING_EFFORTS.includes(selection.reasoningEffort))) throw new Error('Choose a supported OpenAI reasoning effort.');
  if (selection.speedMode !== undefined && (selection.provider !== 'openai' || !OPENAI_SPEED_MODES.includes(selection.speedMode))) throw new Error('Choose a supported OpenAI speed mode.');
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

/** Capture manual effort with the model so a queued run cannot change settings. */
export function withEditorReasoning(selection: ClaudeModelSelection, effort?: OpenAIReasoningEffort, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (effort === undefined) return selection;
  if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual reasoning selection is currently disabled.');
  if (selection.provider !== 'openai' || !OPENAI_REASONING_EFFORTS.includes(effort)) throw new Error('Choose a supported OpenAI reasoning effort.');
  return { ...selection, reasoningEffort: effort };
}

export function withEditorSpeed(selection: ClaudeModelSelection, speedMode?: OpenAISpeedMode, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (speedMode === undefined) return selection;
  if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual speed selection is currently disabled.');
  if (selection.provider !== 'openai' || !OPENAI_SPEED_MODES.includes(speedMode)) throw new Error('Choose a supported OpenAI speed mode.');
  return { ...selection, speedMode };
}

export function claudeProviderOptions(modelId: string) {
  if (!/^(?:anthropic\/)?claude-(?:haiku|sonnet|opus)-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    cacheControl: { type: 'ephemeral', ttl: '5m' },
    effort: 'medium',
    thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
    ...(modelId==='claude-sonnet-5-5'?{serviceTier:'standard_only',inferenceGeo:'global'} as const:{}),
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}

export function editorProviderOptions(selection: ClaudeModelSelection) {
  if (selection.provider !== 'openai') return claudeProviderOptions(selection.modelId);
  const openai = {
    reasoningEffort: selection.reasoningEffort ?? 'medium', reasoningMode: 'standard', serviceTier: selection.speedMode === 'fast' ? 'fast' : 'default',
    // History is managed by the existing Agent thread; retain encrypted reasoning
    // in its messages rather than relying on provider-side conversation storage.
    store: false, include: ['reasoning.encrypted_content'],
    promptCacheOptions: { ttl: '30m' },
  } satisfies OpenAIResponsesProviderOptions;
  return { openai };
}

/** Higher effort shares its output allowance with hidden reasoning tokens. */
export function editorMaxOutputTokens(selection: ClaudeModelSelection) {
  if (selection.provider !== 'openai') return 4096;
  return { low: 4096, medium: 4096, high: 16384, xhigh: 24576, max: 32768 }[selection.reasoningEffort ?? 'medium'];
}

export function assertEditorModelConfigured(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env) {
  if (selection.provider === 'openai' && !env.OPENAI_API_KEY?.trim()) throw new Error('OpenAI editing requires OPENAI_API_KEY in this Convex environment. Choose Sonnet or configure the backend key.');
  if (selection.provider === 'anthropic' && !env.ANTHROPIC_API_KEY?.trim()) throw new Error('Claude editing requires ANTHROPIC_API_KEY in this Convex environment.');
  // A captured gateway selection remains pinned even if its selection flag changes.
}
