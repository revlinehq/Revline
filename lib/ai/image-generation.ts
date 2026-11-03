import { generateImage as generateOpenAIImage, APICallError } from 'ai';
import { z } from 'zod';
import { activeOpenAIKey, editorOpenAI } from './openai-keys';

// GPT Image 2 rejects transparent backgrounds; Flare supports both plates and cut-outs.
export const IMAGE_MODEL = 'gpt-image-2.5-flare';
const sizes = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1536x864', '9:16': '864x1536', '4:5': '1024x1280', '4:3': '1536x1152', '2:1': '1536x768' } as const;
const shotLine = z.string().trim().min(1).max(240).regex(/^[^\r\n]+$/, 'Use one line.');
const storyboardInput = z.object({
  name: z.string().trim().min(1).max(60).describe('Shared storyboard label; reuse it for every shot in this board.'),
  shotIndex: z.number().int().min(1).max(24),
  phase: z.enum(['rough', 'style', 'direction', 'board']).optional().describe('Default rough: complete black-ink drawings of the final shot and its exact text, without annotations. style: 2–3 final-look moments. direction/board remain readable for older boards.'),
  start: z.number().nonnegative().optional(),
  duration: z.number().positive().max(180).optional(),
  idea: shotLine.describe('The shot idea in one line.'),
  visual: z.string().trim().min(1).max(1000).optional().describe('What the shot shows; defaults to the image prompt.'),
  onScreenText: z.string().max(500).optional().describe('Exact words to draw legibly in the sketch and rebuild as editable type in the final film.'),
  motion: shotLine.describe('Plain words, not seconds: headline fades up, cards spin in and stack.'),
  transition: shotLine.optional().describe('How this shot leads into the next.'),
  assetsNeeded: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
}).strict();
export const imageGenerationInput = z.object({
  prompt: z.string().trim().min(1).max(16000).describe('Storyboard: one shot composition in the intended look. Asset: describe subject, framing, palette, material and use. Keep final type/logos in code.'),
  purpose: z.enum(['asset', 'storyboard']).optional().describe('Default asset. Storyboard saves one numbered reference frame, never a timeline clip; needs storyboard shot details.'),
  quality: z.enum(['low', 'medium']).optional().describe('Storyboard defaults low for cheap, fast look development; assets default medium.'),
  storyboard: storyboardInput.optional(),
  aspectRatio: z.enum(['1:1', '3:2', '2:3', '16:9', '9:16', '4:5', '4:3', '2:1']).optional().describe('Default 1:1 for assets, current timeline ratio for storyboards. Choose aspectRatio or size, not both.'),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536', '1536x864', '864x1536', '1024x1280', '1536x1152', '1536x768']).optional(),
  transparentBackground: z.boolean().optional().describe('Default false. True requests a PNG cut-out with alpha.'),
  referenceAssetIds: z.array(z.string().min(1)).min(1).max(4).optional().describe('Project image asset IDs to edit or use as subject references; never reference-video frames.'),
  count: z.number().int().min(1).max(4).optional().describe('Number of variants, default 1. Each variant is a paid image.'),
}).strict().superRefine((input, ctx) => {
  if (input.aspectRatio && input.size) ctx.addIssue({ code: 'custom', message: 'Choose aspectRatio or size, not both.' });
  if ((input.purpose === 'storyboard') !== !!input.storyboard) ctx.addIssue({ code: 'custom', message: 'purpose storyboard needs storyboard shot details; asset generation omits them.' });
  if (input.purpose === 'storyboard' && (input.count ?? 1) !== 1) ctx.addIssue({ code: 'custom', message: 'Generate one key frame per storyboard shot; use another shotIndex for another shot.' });
});
export type ImageGenerationInput = z.infer<typeof imageGenerationInput>;
export const imageGenerationSize = (input: ImageGenerationInput) => input.size ?? sizes[input.aspectRatio ?? '1:1'];
export const imageGenerationQuality = (input: ImageGenerationInput) => input.quality ?? (input.purpose === 'storyboard' ? 'low' : 'medium');

/** Resolve a storyboard's format from the selected timeline, while preserving asset defaults. */
export function resolveImageGeneration(input: ImageGenerationInput, aspectRatio: import('../editor/types').AspectRatio): ImageGenerationInput {
  if (input.purpose !== 'storyboard' || input.aspectRatio || input.size) return input;
  const target = { landscape: '16:9', vertical: '9:16', square: '1:1', 'portrait-feed': '4:5', classic: '4:3' } as const;
  return { ...input, aspectRatio: target[aspectRatio] };
}

const tokenDetails = z.object({ textTokens: z.number().int().nonnegative(), imageTokens: z.number().int().nonnegative() });

/** Uses the shared key fallback and the SDK's bounded retries; PNG bytes are stored untouched. */
export async function generateImagePlates(input: ImageGenerationInput, references: string[], abortSignal: AbortSignal) {
  if (!activeOpenAIKey()) throw new Error('Image generation is not configured (OPENAI_API_KEY and OPENAI_API_KEY_FALLBACK are missing).');
  const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(240_000)]);
  let result;
  try {
    // These URLs come only from owned project storage. Read them with the runtime's fetch:
    // the SDK's Node URL downloader dynamically requires undici, absent in Convex actions.
    const referenceImages = await Promise.all(references.map(async (url, index) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Reference image ${index + 1} could not be read (HTTP ${response.status} ${response.statusText}).`);
      return new Uint8Array(await response.arrayBuffer());
    }));
    result = await generateOpenAIImage({
      model: editorOpenAI().image(IMAGE_MODEL),
      prompt: referenceImages.length ? { text: input.prompt, images: referenceImages } : input.prompt,
      n: input.count ?? 1, maxImagesPerCall: 4, size: imageGenerationSize(input), maxRetries: 2,
      abortSignal: signal,
      providerOptions: { openai: { quality: imageGenerationQuality(input), background: input.transparentBackground ? 'transparent' : 'opaque', outputFormat: 'png' } },
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
    ? Math.round((textTokens * 5 + imageTokens * 8 + outputTokens * 30) / 1_000_000 * 1e12) / 1e12 : null;
  const usage = { inputTokens, outputTokens, textTokens, imageTokens, estimatedUsd };
  return { usage, images: result.images.map(image => {
    const bytes = Uint8Array.from(image.uint8Array);
    if (bytes.length < 33 || new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(0) !== 0x89504e47) throw new Error('OpenAI returned an invalid PNG image.');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { bytes, data: image.base64, width: header.getUint32(16), height: header.getUint32(20) };
  }) };
}
