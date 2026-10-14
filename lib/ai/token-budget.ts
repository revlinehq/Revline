import type { LanguageModelV4CallOptions, LanguageModelV4Usage, LanguageModelV4ToolResultPart } from '@ai-sdk/provider';
import type { LanguageModelMiddleware } from 'ai';
import { compactEditorPrompt } from './editor-context';

export const EDITOR_TOKEN_LIMITS = { requestBytes: 208_000, transportBytes: 24_000_000, inputTokens: 300_000, outputTokens: 12_000, outputPerCall: 4096 } as const;
type TokenLimits = { [K in keyof typeof EDITOR_TOKEN_LIMITS]: number };

export class AssistantTokenBudgetError extends Error {
  constructor(reason: 'context' | 'tokens' | 'usage') {
    super(reason === 'context'
      ? 'The request context is too large to send safely. Visual evidence was preserved. Previously saved edits remain; use a narrower source window or request.'
      : reason === 'usage' ? 'Claude did not report reliable token usage, so further paid requests were stopped. Previously saved edits remain.'
      : 'This request reached its token budget. Previously saved edits remain; continue from the current timeline.');
    this.name = 'AssistantTokenBudgetError';
  }
}

/** Token safety, independent of pricing and cache hits. UTF-8 bytes overestimate
 * ordinary text tokens; reserve extra overhead and image tokens before sending.
 * The reservation is retained on failed calls, retries and missing usage.
 */
export class AssistantTokenBudget {
  private input = 0;
  private output = 0;
  private blocked = false;
  constructor(private limits: TokenLimits = EDITOR_TOKEN_LIMITS) {}
  get usage() { return { inputTokens: this.input, outputTokens: this.output }; }

  reserve(params: LanguageModelV4CallOptions) {
    if (this.blocked) throw new AssistantTokenBudgetError('usage');
    const payload = { prompt: params.prompt, tools: params.tools, responseFormat: params.responseFormat };
    const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    if (encodedBytes(payload) > this.limits.transportBytes) throw new AssistantTokenBudgetError('context');
    let images = 0;
    const fileForEstimate = <T extends { mediaType: string; data: unknown }>(file: T) => {
      // Claude 4.7+ caps resized image tokens at 4,784/image. Reserve 8,192
      // including metadata rather than charging base64/byte arrays as text.
      // Unknown documents/audio/video cannot be bounded from a URL length.
      if (!/^image\/(?:png|jpeg|webp|gif)$/.test(file.mediaType)) throw new AssistantTokenBudgetError('context');
      images++;
      return { ...file, data: '[image payload preserved]' };
    };
    const estimatedPrompt = params.prompt.map(message => message.role === 'system' ? message : { ...message, content: message.content.map(part => {
      if (part.type === 'file') return fileForEstimate(part);
      if (part.type === 'tool-result' && part.output.type === 'content') return { ...part, output: { ...part.output, value: part.output.value.map(item => item.type === 'file' ? fileForEstimate(item) : item) } };
      return part;
    }) });
    const bytes = encodedBytes({ ...payload, prompt: estimatedPrompt });
    if (bytes > this.limits.requestBytes) throw new AssistantTokenBudgetError('context');
    const reservedInput = bytes + 4096 + images * 8192;
    const reservedOutput = Math.min(params.maxOutputTokens ?? this.limits.outputPerCall, this.limits.outputPerCall);
    if (this.input + reservedInput > this.limits.inputTokens || this.output + reservedOutput > this.limits.outputTokens) throw new AssistantTokenBudgetError('tokens');
    this.input += reservedInput; this.output += reservedOutput;
    let settled = false;
    return (usage: LanguageModelV4Usage) => {
      if (settled) return;
      settled = true;
      const input = usage.inputTokens.total;
      const output = usage.outputTokens.total;
      if (input === undefined || output === undefined || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) { this.blocked = true; return; }
      this.input += input - reservedInput; this.output += output - reservedOutput;
      if (input > reservedInput || output > reservedOutput) this.blocked = true;
    };
  }

  middleware(selectedClipIds: readonly string[] = [], initialRevision?: number): LanguageModelMiddleware {
    const exposedResults = new Map<string, LanguageModelV4ToolResultPart>();
    return {
      transformParams: async ({ params }) => {
        const projected = compactEditorPrompt(params.prompt, selectedClipIds, initialRevision);
        // Claude's preserved thinking and prefix cache require append-only
        // history during a run. Project once, then freeze each exposed result.
        const prompt = projected.map(message => message.role === 'system' ? message : { ...message, content: message.content.map(part => {
          if (part.type !== 'tool-result') return part;
          const exposed = exposedResults.get(part.toolCallId);
          if (exposed) return exposed;
          exposedResults.set(part.toolCallId, part); return part;
        }) } as typeof message);
        return { ...params, prompt, maxOutputTokens: Math.min(params.maxOutputTokens ?? this.limits.outputPerCall, this.limits.outputPerCall) };
      },
      wrapGenerate: async ({ params, doGenerate }) => {
        const settle = this.reserve(params);
        const result = await doGenerate(); settle(result.usage); return result;
      },
      wrapStream: async ({ params, doStream }) => {
        const settle = this.reserve(params);
        const result = await doStream();
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform(part, controller) {
          if (part.type === 'finish') settle(part.usage);
          controller.enqueue(part);
        } })) };
      },
    };
  }
}
