import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { withGeminiFallback, GEMINI_VIDEO_GATEWAY_LIMIT, type GeminiRoute } from './gemini-routing';

export type GeminiGatewayFetch = (body: string, signal?: AbortSignal) => Promise<Response>;

/** Same model and prompt on both routes; the Gateway uses Chat Completions, never a provider credential. */
export function geminiEditingModel(modelId: string, gatewayFetch: GeminiGatewayFetch): LanguageModelV4 {
  const direct = google(modelId);
  const gateway = createOpenAI({
    name: 'convex-gateway', apiKey: 'managed-by-convex', baseURL: 'https://ai-gateway.convex.dev/v1',
    fetch: (_url, init) => gatewayFetch(String(init?.body), init?.signal ?? undefined),
  }).chat(`google/${modelId}`);
  const params = (options: LanguageModelV4CallOptions): LanguageModelV4CallOptions => {
    for (const message of options.prompt) {
      if (message.role === 'system') continue;
      if (message.content.some(part => part.type === 'file' && /^(video|audio)\//.test(part.mediaType))) throw new Error(GEMINI_VIDEO_GATEWAY_LIMIT);
    }
    const config = options.providerOptions?.google?.thinkingConfig as { thinkingLevel?: string } | undefined;
    return { ...options, providerOptions: { ...options.providerOptions, openai: { reasoningEffort: config?.thinkingLevel ?? 'high', strictJsonSchema: false } } };
  };
  return {
    specificationVersion: 'v4', provider: 'google', modelId, supportedUrls: direct.supportedUrls,
    async doGenerate(options) {
      let route: GeminiRoute = 'direct';
      const result = await withGeminiFallback(process.env.GOOGLE_GENERATIVE_AI_API_KEY, () => direct.doGenerate(options), () => { route = 'convex-gateway'; return gateway.doGenerate(params(options)); }, options.abortSignal);
      return { ...result, providerMetadata: { ...result.providerMetadata, revline: { route } } };
    },
    async doStream(options) {
      let route: GeminiRoute = 'direct';
      const result = await withGeminiFallback(process.env.GOOGLE_GENERATIVE_AI_API_KEY, () => direct.doStream(options), () => { route = 'convex-gateway'; return gateway.doStream(params(options)); }, options.abortSignal);
      // Switch only before a stream starts. Never replay a partially generated edit.
      return { ...result, stream: result.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(part, controller) { controller.enqueue(part.type === 'finish' ? { ...part, providerMetadata: { ...part.providerMetadata, revline: { route } } } : part); },
      })) };
    },
  };
}
