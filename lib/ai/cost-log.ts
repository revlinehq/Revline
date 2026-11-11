import { isUsageCount as count } from './usage-counts';
import {EDITOR_SOFT_STEPS,EDITOR_HARD_STEPS,EDITOR_PROGRESS_WINDOW,editStepStopReason,hasRecentEditProgress} from './edit-progress';
import type { LanguageModelUsage, ProviderMetadata } from 'ai';
import { CLAUDE_EDIT_MODELS, OPENAI_EDIT_MODELS, type EditorReasoningEffort, type EditorSpeedMode } from './claude-model';
import { hasRepeatedToolFailures } from './tool-failures';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rounded = (value: number) => Math.round(value * 1e12) / 1e12;
type Counts = { inputTokens: number | null; uncachedInputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; outputTokens: number | null; reasoningTokens: number | null };

/** Token estimates only: tool services, failed/unreported calls and account uplifts are excluded. */
function estimateEditorCallCost(model: string, provider: string, usage?: LanguageModelUsage, metadata?: ProviderMetadata) {
  const counts: Counts = {
    inputTokens: count(usage?.inputTokens) ? usage.inputTokens : null,
    uncachedInputTokens: count(usage?.inputTokenDetails?.noCacheTokens) ? usage.inputTokenDetails.noCacheTokens : null,
    cacheReadTokens: count(usage?.inputTokenDetails?.cacheReadTokens) ? usage.inputTokenDetails.cacheReadTokens : null,
    cacheWriteTokens: count(usage?.inputTokenDetails?.cacheWriteTokens) ? usage.inputTokenDetails.cacheWriteTokens : null,
    outputTokens: count(usage?.outputTokens) ? usage.outputTokens : null,
    reasoningTokens: count(usage?.outputTokenDetails?.reasoningTokens) ? usage.outputTokenDetails.reasoningTokens : null,
  };
  // Each model is priced at its own tariff (lib/ai/claude-model.ts). Claude requests are always Standard:
  // the editor never sends them `speed`, and these models have no Priority Tier.
  const openai = provider === 'openai.responses';
  const tariff = openai ? OPENAI_EDIT_MODELS.find(entry => entry.modelId === model) : provider === 'anthropic.messages' ? CLAUDE_EDIT_MODELS.find(entry => entry.modelId === model) : undefined;
  const serviceTier = openai ? record(metadata?.openai).serviceTier : undefined;
  const speedMultiplier = serviceTier === 'fast' ? 2 : 1;
  let unknownReason: string | null = null;
  if (!tariff) unknownReason = 'unreviewed_model_or_provider';
  else if (openai && serviceTier !== 'default' && serviceTier !== 'fast') unknownReason = 'unconfirmed_standard_tariff';
  // Claude leaves the reasoning count out of a step that did not think; output already includes it, so the price needs no split.
  else if (Object.entries(counts).some(([name, value]) => value === null && (openai || name !== 'reasoningTokens'))) unknownReason = 'missing_usage';
  else if (counts.uncachedInputTokens! + counts.cacheReadTokens! + counts.cacheWriteTokens! !== counts.inputTokens || counts.reasoningTokens! > counts.outputTokens!) unknownReason = 'inconsistent_usage';
  // OpenAI Standard tariffs verified 2026-10-17: above 272K input tokens the request bills 2x input and 1.5x output.
  // Output includes reasoning; never add it twice. https://developers.openai.com/api/docs/pricing
  const longPrompt = openai ? { above: 272_000, input: 2, output: 1.5 } : tariff && 'longPrompt' in tariff ? tariff.longPrompt : undefined;
  const longContext = !!longPrompt && counts.inputTokens !== null && counts.inputTokens > longPrompt.above;
  const inputMultiplier = longContext ? longPrompt.input : 1, outputMultiplier = longContext ? longPrompt.output : 1;
  const estimatedUsd = unknownReason || !tariff ? null : rounded(speedMultiplier * (counts.uncachedInputTokens! * tariff.pricing.input * inputMultiplier + counts.cacheReadTokens! * tariff.pricing.cacheRead * inputMultiplier + counts.cacheWriteTokens! * tariff.pricing.cacheWrite * inputMultiplier + counts.outputTokens! * tariff.pricing.output * outputMultiplier) / 1_000_000);
  return { ...counts, estimatedUsd, unknownReason, longContext, ...(typeof serviceTier === 'string' ? { serviceTier } : {}) };
}

type ModelCall = { callId: string; stepNumber: number; modelId: string; provider: string; usage?: LanguageModelUsage; providerMetadata?: ProviderMetadata; finishReason?: string; content: readonly unknown[] };
type Step = { content: readonly unknown[] };
type Progress = { revision: number; savedEdits: number; staged: boolean; budgetUsed?: number };
type LogRecord = Record<string, unknown>;

/** One provider callback owns accounting; step/tool callbacks only report anomalies. */
export class AssistantCostLog {
  private seen = new Set<string>();
  private calls = 0;
  private toolCalls = 0;
  private knownUsd = 0;
  private unknownCalls = 0;
  private finished = false;
  private model: string | null = null;
  private provider: string | null = null;
  private reasoningEffort?: EditorReasoningEffort;
  private speedMode?: EditorSpeedMode;
  private toolNames = new Set<string>();
  private repeated = new Map<string, { count: number; revision: number }>();
  private steps: Step[] = [];
  constructor(private identity: { projectId: string; runId: string }, private emit: (event: LogRecord) => void = event => console.log(`[ai-cost] ${JSON.stringify(event)}`), private now = () => new Date().toISOString()) {}
  private log(event: LogRecord) { this.emit({ timestamp: this.now(), ...this.identity, ...(this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : {}), ...(this.speedMode ? { speedMode: this.speedMode } : {}), ...event }); }
  selectModel(model: string, provider: string, reasoningEffort?: EditorReasoningEffort, speedMode?: EditorSpeedMode) { this.model = model; this.provider = provider; this.reasoningEffort = reasoningEffort; this.speedMode = speedMode; }

  modelCall(event: ModelCall, progress: Progress) {
    const key = `${event.callId}:${event.stepNumber}`;
    if (this.seen.has(key)) return;
    this.seen.add(key); this.calls++;
    this.model = event.modelId; this.provider = event.provider;
    const cost = estimateEditorCallCost(event.modelId, event.provider, event.usage, event.providerMetadata);
    if (cost.estimatedUsd === null) this.unknownCalls++; else this.knownUsd = rounded(this.knownUsd + cost.estimatedUsd);
    const tools = event.content.map(record).filter(part => part.type === 'tool-call');
    for (const tool of tools) if (typeof tool.toolName === 'string') this.toolNames.add(tool.toolName);
    this.toolCalls += tools.length;
    const warnings: string[] = [];
    for (const tool of tools) {
      // Arguments are used only in memory for equality. Never include them in logs.
      const fingerprint = `${tool.toolName}:${JSON.stringify(tool.input)}`;
      const previous = this.repeated.get(fingerprint);
      const repeat = previous?.revision === progress.revision ? previous.count + 1 : 1;
      this.repeated.set(fingerprint, { count: repeat, revision: progress.revision });
      if (repeat === 3) warnings.push('same_tool_repeated_three_times_without_saved_revision');
    }
    if (this.calls === EDITOR_SOFT_STEPS - 3) warnings.push('approaching_progress_continuation_check');
    if (this.calls === EDITOR_HARD_STEPS - 3) warnings.push('approaching_hard_editing_step_limit');
    if (cost.estimatedUsd === null) warnings.push('cost_unknown');
    this.log({ event: 'model-step', callId: event.callId, model: event.modelId, provider: event.provider, step: event.stepNumber + 1, callCount: this.calls, ...cost, stepEstimatedUsd: cost.estimatedUsd, runEstimatedUsd: this.unknownCalls ? null : this.knownUsd, knownRunEstimatedUsd: this.knownUsd, unknownUsageCalls: this.unknownCalls, toolCallCount: tools.length, runToolCallCount: this.toolCalls, tools: tools.map(tool => tool.toolName), finishReason: event.finishReason, ...progress, warnings });
  }

  toolsFinished(step: Step) {
    this.steps.push({ content: step.content });
    if(this.steps.length===EDITOR_SOFT_STEPS&&hasRecentEditProgress(this.steps))this.log({event:'continuation',reason:'verified_recent_edit_progress',stepCount:this.steps.length,softStepThreshold:EDITOR_SOFT_STEPS,hardStepLimit:EDITOR_HARD_STEPS,progressWindow:EDITOR_PROGRESS_WINDOW});
    if (hasRepeatedToolFailures(this.steps)) this.log({ event: 'anomaly', reason: 'existing_repeated_tool_failure_guard', model: this.model, provider: this.provider, callCount: this.calls, runToolCallCount: this.toolCalls, tools: [...this.toolNames] });
  }

  finish(reason: string, progress?: Progress, unreportedCall = false) {
    if (this.finished) return;
    this.finished = true;
    const stepStopReason=reason==='step_limit'?editStepStopReason(this.steps):null;
    this.log({ event: 'run-summary', reason, model: this.model, provider: this.provider, callCount: this.calls, runToolCallCount: this.toolCalls, tools: [...this.toolNames], knownRunEstimatedUsd: this.knownUsd, runEstimatedUsd: this.unknownCalls || unreportedCall ? null : this.knownUsd, unknownUsageCalls: this.unknownCalls, unreportedCall, stepLimitReached:stepStopReason!==null,stepStopReason,softStepThreshold:EDITOR_SOFT_STEPS,hardStepLimit:EDITOR_HARD_STEPS, ...progress });
  }
}
