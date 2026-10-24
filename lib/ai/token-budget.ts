import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Usage, LanguageModelV4ToolResultPart, SharedV4ProviderMetadata } from '@ai-sdk/provider';
import type { LanguageModelMiddleware } from 'ai';
import { compactEditorPrompt } from './editor-context';

// An anomaly backstop, not a work limit: a three-scene explainer (13 calls)
// used ~10% of these ceilings. Only runaway tool loops should reach them.
export const EDITOR_TOKEN_LIMITS = { requestBytes: 450_000, transportBytes: 24_000_000, inputTokens: 2_000_000, outputTokens: 150_000, outputPerCall: 8192 } as const;
export const EDITOR_RAW_INPUT_LIMIT = 7_000_000;
type TokenLimits = { [K in keyof typeof EDITOR_TOKEN_LIMITS]: number };
type NativeCacheModel = 'anthropic' | 'openai';
/** Per-request financial ceilings, switched on per deployment. Context
 * projection and the per-call output cap apply either way. */
export function editorTokenBudgetEnabled(env:Readonly<Record<string,string|undefined>>=process.env){
  const value=env.EDITOR_ENFORCE_TOKEN_BUDGET;
  if(value===undefined||value===''||value==='false')return false;
  if(value==='true')return true;
  throw new Error('EDITOR_ENFORCE_TOKEN_BUDGET must be true or false.');
}
const record = (value:unknown):Record<string,unknown> => value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count = (value:unknown):value is number => typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

/** Only these native Standard tariffs have the reviewed cache-cost bound. */
function nativeCacheModel(params:LanguageModelV4CallOptions,model?:Pick<LanguageModelV4,'provider'|'modelId'>):NativeCacheModel|undefined {
  const anthropic=model?.provider==='anthropic.messages'&&model.modelId==='claude-sonnet-5-5';
  const openai=model?.provider==='openai.responses'&&model.modelId==='gpt-6.1-sol';
  if(!anthropic&&!openai)return;
  const options=record(params.providerOptions?.[anthropic?'anthropic':'openai']);
  if(anthropic){
    const points:unknown[]=[params,...params.prompt,...(params.tools??[])];
    for(const message of params.prompt)if(message.role!=='system')for(const part of message.content){
      points.push(part);
      if(part.type==='tool-result'){points.push(part.output);if(part.output.type==='content')points.push(...part.output.value);}
    }
    const longCache=points.some(point=>{const control=record(record(record(record(point).providerOptions).anthropic).cacheControl);return control.ttl!==undefined&&control.ttl!=='5m';});
    // Sonnet rejects the speed parameter, including "standard". Its omitted
    // default is Standard; usage must still explicitly confirm that tariff.
    if(longCache||options.speed!==undefined||(options.serviceTier!==undefined&&options.serviceTier!=='standard_only')||(options.inferenceGeo!==undefined&&options.inferenceGeo!=='global')||options.fallbacks!==undefined||options.contextManagement!==undefined||options.compaction!==undefined)throw new AssistantTokenBudgetError('usage');
    if(options.serviceTier!=='standard_only'||options.inferenceGeo!=='global'||record(options.cacheControl).ttl!=='5m')return;
  }else{
    if((options.serviceTier!==undefined&&options.serviceTier!=='default')||(options.reasoningMode!==undefined&&options.reasoningMode!=='standard')||(record(options.promptCacheOptions).ttl!==undefined&&record(options.promptCacheOptions).ttl!=='30m')||['previousResponseId','conversation','instructions','contextManagement','compactionTrigger'].some(key=>options[key]!==undefined))throw new AssistantTokenBudgetError('usage');
    if(options.serviceTier!=='default'||options.reasoningMode!=='standard'||record(options.promptCacheOptions).ttl!=='30m')return;
  }
  if(params.tools?.some(tool=>tool.type!=='function'))throw new AssistantTokenBudgetError('usage');
  return anthropic?'anthropic':'openai';
}

/** Provider-normalized cache split, weighted conservatively (writes 1.25x, reads 0.25x). */
function normalizedInput(usage:LanguageModelV4Usage):number|undefined {
  const input=usage.inputTokens;
  if(!count(input.total)||!count(input.noCache)||!count(input.cacheRead)||!count(input.cacheWrite)||input.noCache+input.cacheRead+input.cacheWrite!==input.total)return;
  return input.noCache+input.cacheWrite*1.25+input.cacheRead*.25;
}

function weightedInput(usage:LanguageModelV4Usage,model:NativeCacheModel,metadata?:SharedV4ProviderMetadata):number|undefined {
  const input=usage.inputTokens,raw=record(usage.raw),output=usage.outputTokens.total;
  if(!count(input.noCache)||!count(input.cacheRead)||!count(input.cacheWrite)||input.noCache+input.cacheRead+input.cacheWrite!==input.total||raw.output_tokens!==output||[usage.outputTokens.text,usage.outputTokens.reasoning].some(value=>value!==undefined&&(!count(value)||value>Number(output)))||(usage.outputTokens.text!==undefined&&usage.outputTokens.reasoning!==undefined&&usage.outputTokens.text+usage.outputTokens.reasoning!==output))return;
  if(model==='anthropic'){
    const creation=record(raw.cache_creation),details=record(metadata?.anthropic);
    if(raw.input_tokens!==input.noCache||raw.cache_read_input_tokens!==input.cacheRead||raw.cache_creation_input_tokens!==input.cacheWrite||creation.ephemeral_1h_input_tokens!==0||creation.ephemeral_5m_input_tokens!==input.cacheWrite||raw.service_tier!=='standard'||raw.speed!=='standard'||raw.inference_geo!=='global'||(raw.iterations!=null&&(!Array.isArray(raw.iterations)||raw.iterations.length>0))||(details.iterations!=null&&(!Array.isArray(details.iterations)||details.iterations.length>0)))return;
  }else{
    const details=record(raw.input_tokens_details),out=record(raw.output_tokens_details),provider=record(metadata?.openai);
    if(raw.input_tokens!==input.total||details.cached_tokens!==input.cacheRead||details.cache_write_tokens!==input.cacheWrite||provider.serviceTier!=='default'||[details.orchestration_input_tokens,details.orchestration_input_cached_tokens,out.orchestration_output_tokens].some(value=>value!==undefined&&value!==0)||(raw.total_tokens!==undefined&&raw.total_tokens!==Number(input.total)+Number(output)))return;
  }
  return input.noCache+input.cacheWrite*1.25+input.cacheRead*.25;
}

export class AssistantTokenBudgetError extends Error {
  constructor(reason: 'context' | 'tokens' | 'usage') {
    super(reason === 'context'
      ? 'The request context is too large to send safely. Visual evidence was preserved. Previously saved edits remain; use a narrower source window or request.'
      : reason === 'usage' ? 'The editing provider did not report reliable token usage, so further paid requests were stopped. Previously saved edits remain.'
      : 'This request reached its token budget. Previously saved edits remain; continue from the current timeline.');
    this.name = 'AssistantTokenBudgetError';
  }
}

/** Reserve full next input at worst cache-write cost; credit only verified usage.
 * The input limit is conservative cost units: verified native tariffs, else
 * the provider-normalized cache split, else raw input. Sol long-context costs
 * <= $4/M units + $15/M output, hence <= ~$10 at these limits.
 * Raw volume, request bytes, output and runtime/step limits remain independent.
 * Calls are charged their actual usage; only missing usage blocks the run.
 */
export class AssistantTokenBudget {
  private input = 0;
  private rawInput = 0;
  private output = 0;
  private blocked = false;
  constructor(private limits: TokenLimits = EDITOR_TOKEN_LIMITS, private onUsage?: (fraction: number) => void) {}
  get usage() { return { inputTokens: this.rawInput, outputTokens: this.output }; }
  /** The largest share of any ceiling this request has used, 0–1. */
  get fraction() { return Math.min(1, Math.max(this.input / this.limits.inputTokens, this.rawInput / EDITOR_RAW_INPUT_LIMIT, this.output / this.limits.outputTokens)); }

  private estimateInput(params:LanguageModelV4CallOptions) {
    if (this.blocked) throw new AssistantTokenBudgetError('usage');
    const payload = { prompt: params.prompt, tools: params.tools, responseFormat: params.responseFormat };
    const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    if (encodedBytes(payload) > this.limits.transportBytes) throw new AssistantTokenBudgetError('context');
    let images = 0;
    const fileForEstimate = <T extends { mediaType: string; data: unknown }>(file: T) => {
      // Claude caps resized image tokens; OpenAI requests force bounded high
      // detail. Reserve 8,192 including metadata instead of base64 as text.
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
    // Serialized JSON and prose run ~3–4 bytes per token; calls settle at actual usage.
    return Math.ceil(bytes/3)+4096+images*8192;
  }

  reserve(params: LanguageModelV4CallOptions,countedInput?:number,model?:Pick<LanguageModelV4,'provider'|'modelId'>) {
    const estimate=this.estimateInput(params);
    const native=nativeCacheModel(params,model),reservedRaw=countedInput??estimate;
    if(!count(reservedRaw))throw new AssistantTokenBudgetError('usage');
    const reservedInput=Math.ceil(reservedRaw*1.25);
    const reservedOutput = Math.min(params.maxOutputTokens ?? this.limits.outputPerCall, this.limits.outputPerCall);
    if(!count(reservedOutput))throw new AssistantTokenBudgetError('usage');
    if (this.input + reservedInput > this.limits.inputTokens || this.rawInput+reservedRaw>EDITOR_RAW_INPUT_LIMIT || this.output + reservedOutput > this.limits.outputTokens) throw new AssistantTokenBudgetError('tokens');
    this.input += reservedInput; this.rawInput+=reservedRaw; this.output += reservedOutput;
    let settled = false;
    return (usage: LanguageModelV4Usage,metadata?:SharedV4ProviderMetadata) => {
      if (settled) return;
      settled = true;
      const input = usage.inputTokens.total;
      const output = usage.outputTokens.total;
      if (!count(input)||!count(output)) { this.blocked = true; return; }
      const charged=(native?weightedInput(usage,native,metadata):undefined)??normalizedInput(usage)??input;
      this.input += charged-reservedInput; this.rawInput+=input-reservedRaw; this.output += output-reservedOutput;
      this.onUsage?.(this.fraction);
    };
  }

  middleware(selectedClipIds: readonly string[] = [], initialRevision?: number, countInput?:(params:LanguageModelV4CallOptions)=>Promise<number>, enforce = true): LanguageModelMiddleware {
    const exposedResults = new Map<string, LanguageModelV4ToolResultPart>();
    const projection:LanguageModelMiddleware={
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
        const maxOutputTokens = params.maxOutputTokens ?? this.limits.outputPerCall;
        return { ...params, prompt, maxOutputTokens: enforce ? Math.min(maxOutputTokens, this.limits.outputPerCall) : maxOutputTokens };
      },
    };
    // Keep compaction and provider continuation identity even when financial
    // test ceilings are off. Do not call counting endpoints in normal edits.
    if(!enforce)return projection;
    return {
      ...projection,
      wrapGenerate: async ({ params, model, doGenerate }) => {
        this.estimateInput(params);
        const counted=countInput?await countInput(params):undefined;
        const settle = this.reserve(params,counted,model);
        const result = await doGenerate(); settle(result.usage,result.providerMetadata); return result;
      },
      wrapStream: async ({ params, model, doStream }) => {
        this.estimateInput(params);
        const counted=countInput?await countInput(params):undefined;
        const settle = this.reserve(params,counted,model);
        const result = await doStream();
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform(part, controller) {
          if (part.type === 'finish') settle(part.usage,part.providerMetadata);
          controller.enqueue(part);
        } })) };
      },
    };
  }
}
