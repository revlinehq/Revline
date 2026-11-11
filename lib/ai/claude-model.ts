import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

// Anthropic first-party Standard rates, USD / 1M tokens, verified 2026-11-11 (5-minute cache writes are 1.25x input).
// Haiku 5.5 has a second rate card: a prompt above 100K tokens bills the whole request at $0.50 in / $2.50 out.
export const CLAUDE_EDIT_MODELS = [
  { id: 'haiku', label: 'Haiku 5.5', modelId: 'claude-haiku-5-5', pricing: { input: .10, cacheRead: .01, cacheWrite: .125, output: .50 }, longPrompt: { above: 100_000, input: 5, output: 5 } },
  { id: 'sonnet', label: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5', pricing: { input: 2, cacheRead: .10, cacheWrite: 2.50, output: 10 } },
  { id: 'opus', label: 'Opus 5.5', modelId: 'claude-opus-5-5', pricing: { input: 4, cacheRead: .20, cacheWrite: 5, output: 20 } },
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
  // Rejects prompt_cache_options; reasoning modes are GPT-6 only.
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', modelId: 'gpt-5.4-mini', pricing: { input: .75, cacheRead: .075, cacheWrite: .9375, output: 4.5 }, legacyOptions: true },
] as const;
export const EDITOR_MODELS = [...OPENAI_EDIT_MODELS, ...CLAUDE_EDIT_MODELS] as const;
/** Editor models no longer offered. Saved choices and queued turns that name one run on the default model. */
export const RETIRED_EDITOR_MODEL_CHOICES = ['gemini-4-argon'] as const;
export function isRetiredEditorModelChoice(choice: unknown): choice is typeof RETIRED_EDITOR_MODEL_CHOICES[number] {
  return RETIRED_EDITOR_MODEL_CHOICES.some(item => item === choice);
}

type ModelPolicyEnvironment = Readonly<Record<string, string | undefined>>;
/** The GPT editing models, always offered; running them needs OPENAI_API_KEY. */
export const OPENAI_EDIT_CHOICES = [OPENAI_EDIT_MODELS[0].id, OPENAI_EDIT_MODELS[1].id, OPENAI_EDIT_MODELS[2].id] as const;
/** The model editing uses when neither the request nor EDITOR_DEFAULT_MODEL names one: GPT-6.1 Sol. */
export const DEFAULT_EDITOR_MODEL = OPENAI_EDIT_MODELS[0].id;
/** The model free accounts edit with: GPT-6.1 Terra. */
export const FREE_EDITOR_MODEL_CHOICE = OPENAI_EDIT_MODELS[2].id;
/** Claude editing models, offered on paid plans when ANTHROPIC_API_KEY is configured. Fast to strong: Haiku, Sonnet, Opus. */
const ANTHROPIC_EDIT_CHOICES = CLAUDE_EDIT_MODELS.map(model => model.id);
const ANTHROPIC_EDIT_MODEL_IDS: readonly string[] = CLAUDE_EDIT_MODELS.map(model => model.modelId);
export const EDITOR_MODEL_CATALOG = [...OPENAI_EDIT_CHOICES, ...ANTHROPIC_EDIT_CHOICES] as const;
const modelLabels = (ids: readonly string[]) => ids.map(id => EDITOR_MODELS.find(model => model.id === id)!.label);
const listLabels = (labels: readonly string[]) => `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
export const GPT_ONLY_EDITING_ERROR = `Revline editing supports ${listLabels(modelLabels(EDITOR_MODEL_CATALOG))}. Choose a supported model.`;
/** Which backend key enables which models, for the not-configured message. */
export const EDITOR_PROVIDER_REASON = `Configure OPENAI_API_KEY (${modelLabels(OPENAI_EDIT_CHOICES).join(', ')}) or ANTHROPIC_API_KEY (${modelLabels(ANTHROPIC_EDIT_CHOICES).join(', ')}) in Convex to edit.`;

export function allowedClaudeModelChoices(env: ModelPolicyEnvironment = process.env): readonly ((typeof OPENAI_EDIT_CHOICES)[number] | (typeof ANTHROPIC_EDIT_CHOICES)[number])[] {
  return [...OPENAI_EDIT_CHOICES, ...(env.ANTHROPIC_API_KEY?.trim() ? ANTHROPIC_EDIT_CHOICES : [])];
}

export function enforceClaudeModelPolicy(selection: ClaudeModelSelection, env: ModelPolicyEnvironment = process.env): ClaudeModelSelection {
  const choice = selection.modelChoice;
  if (selection.provider === 'openai') {
    if (!OPENAI_EDIT_CHOICES.some(item => item === selection.modelId) || (choice !== undefined && !OPENAI_EDIT_CHOICES.some(item => item === choice))) throw new Error(GPT_ONLY_EDITING_ERROR);
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
export const EDITOR_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type EditorReasoningEffort = typeof EDITOR_REASONING_EFFORTS[number];
export const EDITOR_SPEED_MODES = ['standard', 'fast'] as const;
export type EditorSpeedMode = typeof EDITOR_SPEED_MODES[number];
// Every editor model takes an effort level; Fast mode is OpenAI-only here.
// Sonnet 5.5 and Haiku 5.5 reject `speed`, and Opus 5.5 fast mode is a research preview
// this Anthropic org has no rate limit for (0 tokens/min, 2026-10-25).
function editorModelSupportsFast(selection: Pick<ClaudeModelSelection, 'provider'>) {
  return selection.provider === 'openai';
}
// Legacy IDs remain decodable for historical records and stale queued requests.
export type ClaudeModelChoice = typeof OPENAI_EDIT_MODELS[number]['id'] | typeof CLAUDE_EDIT_MODELS[number]['id'];
export type ClaudeModelSelection = { provider: 'anthropic' | 'gateway' | 'openai'; modelId: string; modelChoice?: ClaudeModelChoice; reasoningEffort?: EditorReasoningEffort; speedMode?: EditorSpeedMode };
/** A pin as saved in queued turns, which may still name a retired model or provider. */
export type StoredModelSelection = Omit<ClaudeModelSelection, 'provider' | 'modelChoice' | 'reasoningEffort'> & { provider: ClaudeModelSelection['provider'] | 'google'; modelChoice?: ClaudeModelChoice | typeof RETIRED_EDITOR_MODEL_CHOICES[number]; reasoningEffort?: unknown };
type ClaudeModelEnvironment = Readonly<Record<string, string | undefined>>;

export function claudeModelSwitcherEnabled(env: ClaudeModelEnvironment = process.env) {
  return env.MODEL_SWITCHER_ENABLED === 'true';
}

export function resolveClaudeModel(modelChoice?: ClaudeModelChoice, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (modelChoice !== undefined && !claudeModelSwitcherEnabled(env)) throw new Error('Manual model selection is currently disabled.');
  const configured = env.EDITOR_DEFAULT_MODEL?.trim();
  const choice = modelChoice ?? (configured && !isRetiredEditorModelChoice(configured) ? configured : DEFAULT_EDITOR_MODEL);
  const selected = OPENAI_EDIT_MODELS.find(model => model.id === choice);
  if (selected) return enforceClaudeModelPolicy({ provider: 'openai', modelId: selected.modelId, modelChoice: selected.id }, env);
  const claude = CLAUDE_EDIT_MODELS.find(model => model.id === choice && EDITOR_MODELS.some(item => item.id === model.id));
  if (!claude) throw new Error(GPT_ONLY_EDITING_ERROR);
  return enforceClaudeModelPolicy({ provider: 'anthropic', modelId: claude.modelId, modelChoice: claude.id }, env);
}

/** The effort used when a request names none; EDITOR_DEFAULT_EFFORT sets it per deployment. */
export function defaultEditorReasoningEffort(env: ClaudeModelEnvironment = process.env): EditorReasoningEffort {
  const effort = env.EDITOR_DEFAULT_EFFORT?.trim();
  if (effort === 'max' || effort === 'ultra') return 'xhigh';
  return EDITOR_REASONING_EFFORTS.find(item => item === effort) ?? 'medium';
}

/** Decode saved preferences and incoming requests into the four supported efforts. */
export function normalizeEditorReasoningEffort(value: unknown, env: ClaudeModelEnvironment = process.env): EditorReasoningEffort {
  if (value === undefined || value === null || value === 'auto') return defaultEditorReasoningEffort(env);
  if (value === 'max' || value === 'ultra') return 'xhigh';
  const effort = EDITOR_REASONING_EFFORTS.find(item => item === value);
  if (!effort) throw new Error('Choose a supported reasoning effort.');
  return effort;
}

export function defaultEditorModelChoice(env:ClaudeModelEnvironment=process.env):typeof EDITOR_MODELS[number]['id']|undefined {
  const selected=resolveClaudeModel(undefined,env);
  return EDITOR_MODELS.find(model=>model.modelId===selected.modelId)?.id;
}

export function validatePinnedClaudeModel(input: StoredModelSelection, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection & { reasoningEffort: EditorReasoningEffort } {
  const reasoningEffort = normalizeEditorReasoningEffort(input.reasoningEffort, env);
  // A turn queued with a retired model (Gemini 4 Argon) runs on the deployment default instead of failing.
  if (input.provider === 'google' || isRetiredEditorModelChoice(input.modelChoice)) return { ...resolveClaudeModel(undefined, env), modelChoice: undefined, reasoningEffort };
  const selection = { ...input, provider: input.provider, modelChoice: input.modelChoice, reasoningEffort };
  enforceClaudeModelPolicy(selection, env);
  if (selection.speedMode !== undefined && (!EDITOR_SPEED_MODES.includes(selection.speedMode) || (selection.speedMode === 'fast' && !editorModelSupportsFast(selection)))) throw new Error('Fast mode is not available for this model.');
  const pinned = selection.provider === 'openai' ? selection.modelChoice : CLAUDE_EDIT_MODELS.find(model => model.id === selection.modelChoice)?.modelId;
  if (selection.modelChoice !== undefined && pinned !== selection.modelId) throw new Error('Pinned editor model does not match its selection.');
  return selection;
}

/** The free policy is a server default, independent of manual picker feature flags. */
export function freeEditorModel(env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  return enforceClaudeModelPolicy({ provider: 'openai', modelId: FREE_EDITOR_MODEL_CHOICE, modelChoice: FREE_EDITOR_MODEL_CHOICE, reasoningEffort: 'low' }, env);
}

/** The models and efforts one account may pick, and what runs when it picks nothing. */
export type EditorOffer = { models: readonly ClaudeModelChoice[]; efforts: readonly EditorReasoningEffort[]; default: { model: ClaudeModelChoice; effort: EditorReasoningEffort } };

/** The backend key a model's provider needs; a model whose key is missing is not offered and cannot run. */
export const editorModelProviderKey = (choice: ClaudeModelChoice) => OPENAI_EDIT_MODELS.some(model => model.id === choice) ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

/** Every model the picker had before production was pinned, cheapest first per provider, at every effort they take. */
const ALL_EDITOR_CHOICES = { models: ['haiku', 'sonnet', 'opus', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra'], efforts: EDITOR_REASONING_EFFORTS } as const;

/**
 * What a paid account may pick in production, per plan. This is the one place that widens or narrows it;
 * the composer's pickers, `send` and the run itself all read it, so a choice listed here is the one that runs.
 * `default` runs when nothing is picked and for anything not listed (a stale tab, an old queued turn, iPhone),
 * so no account's cost changes until it picks something else. To give Pro the same list: `pro: ALL_EDITOR_CHOICES`.
 *
 * What a turn can cost, per token against the default, Haiku 5.5 ($0.10 in / $0.50 out per 1M tokens):
 * 'gpt-6.1-terra' 10x ($1 / $5), 'sonnet' and 'gpt-6.1-sol' 20x ($2 / $10), 'opus' 40x ($4 / $20),
 * 'gpt-6-astra' 100x ($10 / $50). 'high' and 'xhigh' keep the token price and spend more thinking and
 * output tokens per turn. Haiku 5.5 itself bills 5x ($0.50 / $2.50) on a prompt above 100K tokens, where these
 * ratios shrink fivefold. The per-request token ceilings (lib/ai/token-budget.ts) count tokens, not dollars.
 */
export const PRODUCTION_EDITOR_OFFER = {
  default: { model: 'haiku', effort: 'medium' },
  pro: { models: ['haiku'], efforts: ['medium'] },
  ultra: ALL_EDITOR_CHOICES,
} as const satisfies { default: EditorOffer['default'] } & Record<'pro' | 'ultra', Omit<EditorOffer, 'default'>>;

/** The plan's list, less every model whose provider key this deployment lacks (the default stays: it is what runs).
 * EDITOR_EFFORT_SWITCHER=false leaves every plan the default effort alone, as it does outside production. */
export function productionEditorOffer(ultra: boolean, env: ClaudeModelEnvironment = process.env): EditorOffer {
  const plan: Omit<EditorOffer, 'default'> = PRODUCTION_EDITOR_OFFER[ultra ? 'ultra' : 'pro'], fallback = PRODUCTION_EDITOR_OFFER.default;
  return { models: plan.models.filter(id => id === fallback.model || !!env[editorModelProviderKey(id)]?.trim()), efforts: editorEffortSwitcherOffered(env) ? plan.efforts : [fallback.effort], default: fallback };
}

/** The selection an offer runs for what was asked: a model or effort it does not list becomes its default. */
export function offeredEditorModel(offer: EditorOffer, asked: { modelChoice?: unknown; reasoningEffort?: unknown } = {}): ClaudeModelSelection & { modelChoice: ClaudeModelChoice; reasoningEffort: EditorReasoningEffort } {
  const choice = offer.models.find(id => id === asked.modelChoice) ?? offer.default.model;
  const reasoningEffort = offer.efforts.find(effort => effort === asked.reasoningEffort) ?? offer.default.effort;
  const model = EDITOR_MODELS.find(item => item.id === choice)!;
  return { provider: OPENAI_EDIT_MODELS.some(item => item.id === choice) ? 'openai' : 'anthropic', modelId: model.modelId, modelChoice: choice, reasoningEffort };
}

/** EDITOR_EFFORT_SWITCHER=false turns the effort picker off for everyone; unset leaves it to the plan. */
export function editorEffortSwitcherOffered(env: ClaudeModelEnvironment = process.env) {
  return env.EDITOR_EFFORT_SWITCHER !== 'false';
}

/** Choosing an effort is an Ultra feature. Deployments without billing meter no one, so every account keeps it there. */
export function editorEffortChoiceAllowed(plan: { billing: boolean; ultra: boolean }, env: ClaudeModelEnvironment = process.env) {
  return editorEffortSwitcherOffered(env) && (!plan.billing || plan.ultra);
}

/** Without the Ultra choice a saved turn never runs above the deployment default: a higher or unknown
 * effort becomes the default, and a lower fixed one (iPhone's medium, the free model's low) stays. */
export function withPlanReasoning<T extends { reasoningEffort?: unknown }>(selection: T, effortChoice: boolean, env: ClaudeModelEnvironment = process.env): T {
  if (effortChoice) return selection;
  const limit = defaultEditorReasoningEffort(env);
  const saved = EDITOR_REASONING_EFFORTS.findIndex(effort => effort === selection.reasoningEffort);
  return saved >= 0 && saved <= EDITOR_REASONING_EFFORTS.indexOf(limit) ? selection : { ...selection, reasoningEffort: limit };
}

/** Capture manual effort with the model so a queued run cannot change settings. */
export function withEditorReasoning(selection: ClaudeModelSelection, effort?: string, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (effort !== undefined && effort !== 'auto' && !claudeModelSwitcherEnabled(env)) throw new Error('Manual reasoning selection is currently disabled.');
  return { ...selection, reasoningEffort: normalizeEditorReasoningEffort(effort, env) };
}

export function withEditorSpeed(selection: ClaudeModelSelection, speedMode?: EditorSpeedMode, env: ClaudeModelEnvironment = process.env): ClaudeModelSelection {
  if (speedMode === undefined) return selection;
  if (!claudeModelSwitcherEnabled(env)) throw new Error('Manual speed selection is currently disabled.');
  if (!EDITOR_SPEED_MODES.includes(speedMode) || (speedMode === 'fast' && !editorModelSupportsFast(selection))) throw new Error('Fast mode is not available for this model.');
  return { ...selection, speedMode };
}

/** Anthropic request options for the Claude editing models. */
function claudeProviderOptions(modelId: string, effort: EditorReasoningEffort = defaultEditorReasoningEffort()) {
  if (!/^(?:anthropic\/)?claude-(?:haiku|sonnet|opus)-5[.-]5$/.test(modelId)) return undefined;
  const anthropic = {
    cacheControl: { type: 'ephemeral', ttl: '5m' },
    effort,
    // Summarized, so the chat can show what Claude is thinking about instead of a silent wait.
    thinking: { type: 'adaptive', display: 'summarized', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
    ...(modelId==='claude-sonnet-5-5'?{serviceTier:'standard_only',inferenceGeo:'global'} as const:{}),
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}

export function editorProviderOptions(selection: ClaudeModelSelection, cacheKey?: string) {
  if (selection.provider !== 'openai') { const options = claudeProviderOptions(selection.modelId, selection.reasoningEffort); if (!options) throw new Error(GPT_ONLY_EDITING_ERROR); return options; }
  // GPT-6 models take reasoning modes, cache retention and all four efforts; older
  // models reject those request fields outright.
  const legacy = OPENAI_EDIT_MODELS.some(model => model.modelId === selection.modelId && 'legacyOptions' in model);
  const effort = selection.reasoningEffort ?? defaultEditorReasoningEffort();
  const openai = {
    reasoningEffort: effort, ...(legacy ? {} : { reasoningMode: 'standard' as const }), serviceTier: selection.speedMode === 'fast' ? 'fast' : 'default',
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
  // Claude gets its model maximum: thinking and the scene share this allowance, and a lower cap cut runs off
  // after they had already paid for the thinking.
  if (selection.provider === 'anthropic') return 128_000;
  // GPT needs room for a whole scene (about 10k tokens of code) plus their reasoning in one step; a lower cap
  // cut scenes off mid-write ("reached the model output limit") or pushed models to shorten them. Billing is per token used.
  return { low: 32_768, medium: 49_152, high: 65_536, xhigh: 65_536 }[selection.reasoningEffort ?? defaultEditorReasoningEffort()];
}

export function assertEditorModelConfigured(selection: ClaudeModelSelection, env: ClaudeModelEnvironment = process.env) {
  enforceClaudeModelPolicy(selection, env);
}
