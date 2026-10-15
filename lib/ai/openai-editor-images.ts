import type { LanguageModelMiddleware } from 'ai';

/** Bound image input costs instead of GPT-6's original-resolution auto detail.
 * High detail uses a 2,500-patch budget, within our 8,192-token image reserve.
 * https://developers.openai.com/api/docs/guides/images-vision
 * Preserve image bytes, source times and all other evidence in the shared thread.
 */
export const openAIEditorImages: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const image = <T extends { type: string; mediaType?: string; providerOptions?: Record<string, Record<string, unknown>> }>(part: T): T =>
      part.type === 'file' && part.mediaType?.startsWith('image/') ? { ...part, providerOptions: { ...part.providerOptions, openai: { ...part.providerOptions?.openai, imageDetail: 'high' } } } : part;
    return { ...params, prompt: params.prompt.map(message => message.role === 'system' ? message : {
      ...message, content: message.content.map(part => {
        if (part.type === 'tool-result' && part.output.type === 'content') return { ...part, output: { ...part.output, value: part.output.value.map(image) } };
        return image(part);
      }),
    } as typeof message) };
  },
};
