import { generateImage as generateOpenAIImage, APICallError } from 'ai';
import { z } from 'zod';
import { activeOpenAIKey, editorOpenAI } from './openai-keys';

export const IMAGE_MODEL = 'gpt-image-2';
const sizes = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1536x864', '9:16': '864x1536' } as const;
export const imageGenerationInput = z.object({
  prompt: z.string().trim().min(1).max(16000).describe('One isolated subject, framing, palette and material. Include no text; use transparentBackground for cut-outs.'),
  aspectRatio: z.enum(['1:1', '3:2', '2:3', '16:9', '9:16']).optional().describe('Default 1:1. Choose aspectRatio or size, not both.'),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536', '1536x864', '864x1536']).optional(),
  transparentBackground: z.boolean().optional().describe('Default false. True requests a PNG cut-out with alpha.'),
  referenceAssetIds: z.array(z.string().min(1)).min(1).max(4).optional().describe('Project image asset IDs to edit or use as subject references; never reference-video frames.'),
  count: z.number().int().min(1).max(4).optional().describe('Number of variants, default 1. Each variant is a paid image.'),
}).strict().refine(input => !(input.aspectRatio && input.size), { message: 'Choose aspectRatio or size, not both.' });
export type ImageGenerationInput = z.infer<typeof imageGenerationInput>;
export const imageGenerationSize = (input: ImageGenerationInput) => input.size ?? sizes[input.aspectRatio ?? '1:1'];

const tokenDetails = z.object({ textTokens: z.number().int().nonnegative(), imageTokens: z.number().int().nonnegative() });

/** Uses the shared key fallback and the SDK's bounded retries; PNG bytes are stored untouched. */
export async function generateImagePlates(input: ImageGenerationInput, references: string[], abortSignal: AbortSignal) {
  if (!activeOpenAIKey()) throw new Error('Image generation is not configured (OPENAI_API_KEY and OPENAI_API_KEY_FALLBACK are missing).');
  let result;
  try {
    result = await generateOpenAIImage({
      model: editorOpenAI().image(IMAGE_MODEL),
      prompt: references.length ? { text: input.prompt, images: references } : input.prompt,
      n: input.count ?? 1, maxImagesPerCall: 4, size: imageGenerationSize(input), maxRetries: 2,
      abortSignal: AbortSignal.any([abortSignal, AbortSignal.timeout(240_000)]),
      providerOptions: { openai: { quality: 'medium', background: input.transparentBackground ? 'transparent' : 'opaque', outputFormat: 'png' } },
    });
  } catch (error) {
    if (abortSignal.aborted) throw new Error('Image generation was stopped before it finished.');
    if (APICallError.isInstance(error)) throw new Error(`OpenAI image generation failed (${error.statusCode ?? 'network error'}): ${error.message}`);
    throw error;
  }
  const details = result.images.map(image => tokenDetails.safeParse(image.providerMetadata?.openai));
  const inputTokens = result.usage.inputTokens ?? null, outputTokens = result.usage.outputTokens ?? null;
  const textTokens = details.every(item => item.success) ? details.reduce((sum, item) => sum + (item.success ? item.data.textTokens : 0), 0) : null;
  const imageTokens = details.every(item => item.success) ? details.reduce((sum, item) => sum + (item.success ? item.data.imageTokens : 0), 0) : null;
  // Direct Images API tariffs, verified 2026-11-02: no cached input discount.
  // https://developers.openai.com/api/docs/pricing
  const estimatedUsd = inputTokens !== null && outputTokens !== null && textTokens !== null && imageTokens !== null && textTokens + imageTokens === inputTokens
    ? Math.round((textTokens * 2.5 + imageTokens * 4 + outputTokens * 15) / 1_000_000 * 1e12) / 1e12 : null;
  const usage = { inputTokens, outputTokens, textTokens, imageTokens, estimatedUsd };
  return { usage, images: result.images.map(image => {
    const bytes = Uint8Array.from(image.uint8Array);
    if (bytes.length < 33 || new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(0) !== 0x89504e47) throw new Error('OpenAI returned an invalid PNG image.');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { bytes, data: image.base64, width: header.getUint32(16), height: header.getUint32(20) };
  }) };
}
