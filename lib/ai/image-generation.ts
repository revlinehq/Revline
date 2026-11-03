import { generateImage as generateOpenAIImage, APICallError } from 'ai';
import { z } from 'zod';
import { activeOpenAIKey, editorOpenAI } from './openai-keys';

// GPT Image 2 rejects transparent backgrounds; Flare supports both plates and cut-outs.
export const IMAGE_MODEL = 'gpt-image-2.5-flare';
const sizes = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1536x864', '9:16': '864x1536', '4:5': '1024x1280', '4:3': '1536x1152', '2:1': '1536x768' } as const;
const shotLine = z.string().trim().min(1).max(240).regex(/^[^\r\n]+$/, 'Use one line.');
const panelFields = {
  shotIndex: z.number().int().min(1).max(24).describe('Shot number within a direction. On a sheet’s outer storyboard metadata, use a sheet index unique across A/B pages; reuse it only for a corrected version of that sheet.'),
  start: z.number().nonnegative().optional(),
  duration: z.number().positive().max(180).optional(),
  idea: shotLine.describe('The shot idea in one line.'),
  visual: z.string().trim().min(1).max(1000).optional().describe('What the shot shows; defaults to the image prompt.'),
  onScreenText: z.string().max(500).optional().describe('Exact words to draw legibly in the sketch and rebuild as editable type in the final film.'),
  motion: shotLine.describe('Plain words, not seconds: headline fades up, cards spin in and stack.'),
  transition: shotLine.optional().describe('How this shot leads into the next.'),
  assetsNeeded: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
};
const storyboardInput = z.object({
  name: z.string().trim().min(1).max(60).describe('Shared storyboard label; reuse for every sheet and key frame.'),
  ...panelFields,
  phase: z.enum(['sheet', 'rough', 'style', 'direction', 'board']).optional().describe('sheet: one ink page, possibly both A/B rows. style: 2–3 full-size key frames after the sheet pick. Other phases preserve older boards.'),
  sheet: z.object({
    rows: z.number().int().min(1).max(4), columns: z.number().int().min(1).max(4),
    panelAspectRatio: z.enum(['landscape', 'vertical', 'square', 'portrait-feed', 'classic']),
    panels: z.array(z.object({ ...panelFields, row: z.number().int().min(1).max(4), column: z.number().int().min(1).max(4), direction: z.enum(['A', 'B']) }).strict()).min(2).max(8),
  }).strict().optional().describe('Required for phase sheet. Rows/columns are 1-based. For combined A/B, row 1 is A and row 2 B; number shots separately per direction. For longer options use separate sheets, at most 8 panels each.'),
}).strict();
export const imageGenerationInput = z.object({
  prompt: z.string().trim().min(1).max(16000).describe('Storyboard: an ink sheet or full-size key frame; read image-direction for the sheet template. Asset: subject, framing, palette, material and use. Keep final film type/logos editable in code.'),
  purpose: z.enum(['asset', 'storyboard']).optional().describe('Default asset. Storyboard saves a reference sheet or key frame, never a timeline clip; needs storyboard details.'),
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
  if (input.purpose === 'storyboard' && (input.count ?? 1) !== 1) ctx.addIssue({ code: 'custom', message: 'Generate one sheet or key frame per call. A/B with 2–3 panels per option shares one sheet.' });
  const board = input.storyboard, sheet = board?.sheet;
  if ((board?.phase === 'sheet') !== !!sheet) ctx.addIssue({ code: 'custom', message: 'phase sheet requires sheet layout and panel details; other phases omit sheet.' });
  if (sheet) {
    if (imageGenerationQuality(input) !== 'low') ctx.addIssue({ code: 'custom', message: 'Sketch sheets use low quality.' });
    if (sheet.rows * sheet.columns !== sheet.panels.length || new Set(sheet.panels.map(p => `${p.row}:${p.column}`)).size !== sheet.panels.length || sheet.panels.some(p => p.row > sheet.rows || p.column > sheet.columns)) ctx.addIssue({ code: 'custom', message: 'Fill every grid cell exactly once, with at most 8 panels.' });
    const directions = new Set(sheet.panels.map(p => p.direction));
    if (directions.size === 2 && (sheet.rows !== 2 || sheet.columns < 2 || sheet.columns > 3 || sheet.panels.some(p => p.row !== (p.direction === 'A' ? 1 : 2)))) ctx.addIssue({ code: 'custom', message: 'Combined A/B sheets have two rows: A above B, each with 2–3 panels. Longer options use separate sheets.' });
    for (const direction of directions) {
      const panels = sheet.panels.filter(p => p.direction === direction).sort((a, b) => a.row - b.row || a.column - b.column);
      if (panels.some((p, i) => i > 0 && p.shotIndex !== panels[i - 1].shotIndex + 1)) ctx.addIssue({ code: 'custom', message: 'Order each direction’s panels left to right, top to bottom, with consecutive shot indices.' });
    }
  }
});
export type ImageGenerationInput = z.infer<typeof imageGenerationInput>;
export const imageGenerationSize = (input: ImageGenerationInput) => input.size ?? sizes[input.aspectRatio ?? '1:1'];
export const imageGenerationQuality = (input: ImageGenerationInput) => input.quality ?? (input.purpose === 'storyboard' ? 'low' : 'medium');

/** Resolve a storyboard's format from the selected timeline, while preserving asset defaults. */
export function resolveImageGeneration(input: ImageGenerationInput, aspectRatio: import('../editor/types').AspectRatio): ImageGenerationInput {
  const target = { landscape: '16:9', vertical: '9:16', square: '1:1', 'portrait-feed': '4:5', classic: '4:3' } as const;
  const layout = input.storyboard?.sheet;
  if (layout) {
    const labels = new Set(layout.panels.map(panel => panel.direction)).size === 2 ? 'Label the top row A and the bottom row B.' : `Direction ${layout.panels[0].direction}.`;
    input = { ...input, prompt: `${input.prompt}\n\nDraw ONE storyboard sheet, ${layout.rows} rows by ${layout.columns} columns, ${layout.panels.length} panels. Read left to right, top to bottom. Every PANEL is ${target[layout.panelAspectRatio]}; the whole page is not a single film frame. Centre the grid on white paper with thin gutters and outer white margins if needed; never stretch a panel to fill the page. ${labels} Only small panel numbers and A/B labels may sit outside the drawings; no arrows, captions or production notes. Clean black-ink contours, cross-hatching and light diagonal pencil strokes; no colour.\n${[...layout.panels].sort((a, b) => a.row - b.row || a.column - b.column).map(panel => `Row ${panel.row}, column ${panel.column}, ${panel.direction}${panel.shotIndex}: ${panel.visual ?? panel.idea}. Exact on-screen text: ${JSON.stringify(panel.onScreenText ?? '')}.`).join('\n')}` };
  }
  if (input.purpose !== 'storyboard' || input.aspectRatio || input.size) return input;
  if (input.storyboard?.sheet) {
    const sheet = input.storyboard.sheet, [width, height] = target[sheet.panelAspectRatio].split(':').map(Number);
    const ratio = width / height * sheet.columns / sheet.rows;
    const nearest = (Object.keys(sizes) as (keyof typeof sizes)[]).sort((a, b) => {
      const [aw, ah] = a.split(':').map(Number), [bw, bh] = b.split(':').map(Number);
      return Math.abs(Math.log(aw / ah / ratio)) - Math.abs(Math.log(bw / bh / ratio));
    })[0];
    return { ...input, aspectRatio: nearest };
  }
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
