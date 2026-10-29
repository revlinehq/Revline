import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import { enforceClaudeModelPolicy, GPT_ONLY_EDITING_ERROR } from './claude-model-policy';

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
// https://openai.com/index/introducing-gpt-6-1-terra/ (verified 2026-10-27)
// Above 272K input tokens the full request uses 2x input/cache and 1.5x output.
export const OPENAI_EDIT_MODELS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', modelId: 'gpt-6.1-sol', pricing: { input: 2, cacheRead: .10, cacheWrite: 2.50, output: 10 } },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', modelId: 'gpt-6-astra', pricing: { input: 10, cacheRead: 1, cacheWrite: 12.50, output: 50 } },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', modelId: 'gpt-6.1-terra', pricing: { input: 1, cacheRead: .05, cacheWrite: 1.25, output: 5 } },
  // No longer offered (Terra replaced it); kept so past costs and stale queued requests still resolve.
  // Cheaper agent model (third-party price trackers, Oct 2026); cache rates assume Sol's ratios.
  // Rejects prompt_cache_options and the 'max' effort (OpenAI API, Oct 2026); reasoning modes are GPT-6 only.
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', modelId: 'gpt-5.4-mini', pricing: { input: .75, cacheRead: .075, cacheWrite: .9375, output: 4.5 }, legacyOptions: true },
] as const;
// Google rates, USD / 1M tokens, from ai.google.dev/gemini-api/docs/pricing (2026-10-29): $2 input,
// $10 output, $0.10 implicit cache reads until 2026-11-30; $4 / $20 / $0.20 from 2026-12-01.
export const GOOGLE_EDIT_MODELS = [
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', modelId: 'gemini-4-argon' },
] as const;
export const EDITOR_MODELS = [...OPENAI_EDIT_MODELS, CLAUDE_EDIT_MODELS[1], CLAUDE_EDIT_MODELS[2], ...GOOGLE_EDIT_MODELS] as const;
export const EDITOR_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EditorReasoningEffort = typeof EDITOR_REASONING_EFFORTS[number];
export const EDITOR_SPEED_MODES = ['standard', 'fast'] as const;
export type EditorSpeedMode = typeof EDITOR_SPEED_MODES[number];
// Every editor model takes an effort level; Fast mode is OpenAI-only here.
// Sonnet 5.5 rejects `speed`, and Opus 5.5 fast mode is a research preview
// this Anthropic org has no rate limit for (0 tokens/min, 2026-10-25).
export function editorModelSupportsFast(selection: Pick<ClaudeModelSelection, 'provider'>) {
  return selection.provider === 'openai';
}
// Legacy IDs remain decodable for historical records and stale queued requests.
export type ClaudeModelChoice = typeof OPENAI_EDIT_MODELS[number]['id'] | typeof CLAUDE_EDIT_MODELS[number]['id'] | typeof GOOGLE_EDIT_MODELS[number]['id'];
export type ClaudeModelSelection = { provider: 'anthropic' | 'gateway' | 'google' | 'openai'; modelId: string; modelChoice?: ClaudeModelChoice; reasoningEffort?: EditorReasoningEffort; speedMode?: EditorSpeedMode };
type ClaudeModelEnvironment = Readonly<Record<string, string | undefined>>;

export function claudeModelSwitcherEnabled(env: ClaudeModelEnvironment = process.env) {
  return env.MODEL_SWITCHER_ENABLED === 'true';
}

export function resolveClaudeModel(modelChoice?: ClaudeModelChoice, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (modelChoice !== undefined && !claudeModelSwitcherEnabled(env)) throw new Error('Manual model selection is currently disabled.');
  const choice = modelChoice ?? (env.EDITOR_DEFAULT_MODEL?.trim() || 'gpt-6.1-sol');
  const selected = OPENAI_EDIT_MODELS.find(model => model.id === choice);
  if (selected) return enforceClaudeModelPolicy({ provider: 'openai', modelId: selected.modelId, modelChoice: selected.id }, env);
  const gemini = GOOGLE_EDIT_MODELS.find(model => model.id === choice);
  if (gemini) return enforceClaudeModelPolicy({ provider: 'google', modelId: gemini.modelId, modelChoice: gemini.id }, env);
  const claude = CLAUDE_EDIT_MODELS.find(model => model.id === choice && EDITOR_MODELS.some(item => item.id === model.id));
  if (!claude) throw new Error(GPT_ONLY_EDITING_ERROR);
  return enforceClaudeModelPolicy({ provider: 'anthropic', modelId: claude.modelId, modelChoice: claude.id }, env);
}

/** The effort used when a request names none; EDITOR_DEFAULT_EFFORT sets it per deployment. */
export function defaultEditorReasoningEffort(env: ClaudeModelEnvironment = process.env): EditorReasoningEffort {
  const effort = env.EDITOR_DEFAULT_EFFORT?.trim();
  return EDITOR_REASONING_EFFORTS.find(item => item === effort) ?? 'medium';
}

export function defaultEditorModelChoice(env:ClaudeModelEnvironment=process.env):typeof EDITOR_MODELS[number]['id']|undefined {
  const selected=resolveClaudeModel(undefined,env);
  return EDITOR_MODELS.find(model=>model.modelId===selected.modelId)?.id;
}

export function validatePinnedClaudeModel(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  enforceClaudeModelPolicy(selection, env);
  if (selection.reasoningEffort !== undefined && !EDITOR_REASONING_EFFORTS.includes(selection.reasoningEffort)) throw new Error('Choose a supported reasoning effort.');
  if (selection.speedMode !== undefined && (!EDITOR_SPEED_MODES.includes(selection.speedMode) || (selection.speedMode === 'fast' && !editorModelSupportsFast(selection)))) throw new Error('Fast mode is not available for this model.');
  const pinned = selection.provider === 'openai' || selection.provider === 'google' ? selection.modelChoice : CLAUDE_EDIT_MODELS.find(model => model.id === selection.modelChoice)?.modelId;
  if (selection.modelChoice !== undefined && pinned !== selection.modelId) throw new Error('Pinned editor model does not match its selection.');
  return selection;
}

/** Capture manual effort with the model so a queued run cannot change settings. */
export function withEditorReasoning(selection: ClaudeModelSelection, effort?: EditorReasoningEffort, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (effort === undefined) return selection;
  if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual reasoning selection is currently disabled.');
  if (!EDITOR_REASONING_EFFORTS.includes(effort)) throw new Error('Choose a supported reasoning effort.');
  return { ...selection, reasoningEffort: effort };
}

export function withEditorSpeed(selection: ClaudeModelSelection, speedMode?: EditorSpeedMode, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (speedMode === undefined) return selection;
  if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual speed selection is currently disabled.');
  if (!EDITOR_SPEED_MODES.includes(speedMode) || (speedMode === 'fast' && !editorModelSupportsFast(selection))) throw new Error('Fast mode is not available for this model.');
  return { ...selection, speedMode };
}

/** Anthropic request options for the Claude editing models. */
export function claudeProviderOptions(modelId: string, effort: EditorReasoningEffort = 'medium') {
  if (!/^(?:anthropic\/)?claude-(?:haiku|sonnet|opus)-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    cacheControl: { type: 'ephemeral', ttl: '5m' },
    effort,
    thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
    ...(modelId==='claude-sonnet-5-5'?{serviceTier:'standard_only',inferenceGeo:'global'} as const:{}),
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}

/** Gemini thinks at low, medium or high; the higher editor efforts map to high. */
export function googleProviderOptions(effort: EditorReasoningEffort = 'medium') {
  const google = { thinkingConfig: { thinkingLevel: effort === 'low' || effort === 'medium' ? effort : 'high' } } satisfies GoogleGenerativeAIProviderOptions;
  return { google };
}

export function editorProviderOptions(selection: ClaudeModelSelection, cacheKey?: string) {
  if (selection.provider === 'google') return googleProviderOptions(selection.reasoningEffort ?? defaultEditorReasoningEffort());
  if (selection.provider !== 'openai') { const options = claudeProviderOptions(selection.modelId, selection.reasoningEffort); if (!options) throw new Error(GPT_ONLY_EDITING_ERROR); return options; }
  // GPT-6 models take reasoning modes, cache retention and every effort; older
  // models reject those request fields outright.
  const legacy = OPENAI_EDIT_MODELS.some(model => model.modelId === selection.modelId && 'legacyOptions' in model);
  const effort = selection.reasoningEffort ?? defaultEditorReasoningEffort();
  const openai = {
    reasoningEffort: legacy && effort === 'max' ? 'xhigh' : effort, ...(legacy ? {} : { reasoningMode: 'standard' as const }), serviceTier: selection.speedMode === 'fast' ? 'fast' : 'default',
    // History is managed by the existing Agent thread; retain encrypted reasoning
    // in its messages rather than relying on provider-side conversation storage.
    store: false, include: ['reasoning.encrypted_content'],
    ...(legacy ? {} : { promptCacheOptions: { ttl: '30m' as const } }),
    // One conversation's requests share a prefix; keep them on the same cache.
    ...(cacheKey ? { promptCacheKey: cacheKey } : {}),
  } satisfies OpenAIResponsesProviderOptions;
  return { openai };
}

/** Higher effort shares its output allowance with hidden reasoning tokens. */
export function editorMaxOutputTokens(selection: ClaudeModelSelection) {
  // A full-size scene module is ~6k tokens of tool input.
  if (selection.provider === 'anthropic') return 8192;
  return { low: 8192, medium: 8192, high: 16384, xhigh: 24576, max: 32768 }[selection.reasoningEffort ?? defaultEditorReasoningEffort()];
}

export function assertEditorModelConfigured(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env) {
  enforceClaudeModelPolicy(selection, env);
}
