import { z } from 'zod';
import { DEFAULT_OUTLINE } from '../../../../editor/clip-outline';
import { DEFAULT_COLOR_GRADE } from '../../../../editor/visual-effects';
import type { Clip, Timeline } from '../../../../editor/types';
import { baseClip, hexColor, placeStack, syncedCopy, type Applied, type ExistingStack, type ReadyLayer, type StackParts } from './layer';

export const layerEffectInput = z.object({
  layerId: z.string().min(1),
  clipId: z.string().min(1).optional().describe('Footage clip to apply to; defaults to the clip the layer was segmented from.'),
  effect: z.enum(['colorOnly', 'grade', 'blur', 'glow', 'outline']),
  target: z.enum(['subject', 'background']).optional().describe("grade/blur only. grade defaults to subject, blur to background."),
  amount: z.number().min(0).max(1).optional().describe('colorOnly: how far the background loses colour (1 = black and white, default 1). blur: strength 0..1 (default .45 = softBlur 18).'),
  color: z.string().regex(hexColor).optional().describe('glow/outline colour, six-digit hex.'),
  width: z.number().min(0).max(24).optional().describe('outline stroke px at 1080p (default 5; glow default 0).'),
  glow: z.number().min(0).max(80).optional().describe('glow radius px at 1080p (glow default 28; outline default 0).'),
  exposure: z.number().min(-2).max(2).optional(),
  contrast: z.number().min(0).max(2).optional(),
  saturation: z.number().min(0).max(2).optional(),
  temperature: z.number().min(-100).max(100).optional(),
  tint: z.number().min(-100).max(100).optional(),
  vibrance: z.number().min(-100).max(100).optional(),
}).strict();
export type LayerEffectInput = z.infer<typeof layerEffectInput>;

export const layerEffectDescription = "Genesis (MCP only). Apply one look to a ready SAM 3.1 layer from segment. effect colorOnly: everything except the subject loses colour (amount 1 = black and white). grade: exposure/contrast/saturation/temperature/tint/vibrance on target subject (default) or background. blur: softBlur on target background (default; subject stays sharp) or subject (softens the subject; NOT anonymization, its sharp edge can show through, so hide faces or plates with a tracked setMask instead). glow / outline: a tracked stroke and halo around the subject's silhouette every frame (also gameplay player outlines); color, width, glow. Built from the footage clip plus synced copies on V rows directly above it, always ordered footage < colour/blur plates < titles < subject cut-outs, so effects and textBehind combine in any order. Preview and export draw the same saved masks. Returns the new clip IDs. Check with getFrames.";

/** The clips each effect stacks above the footage. The original clip itself is never changed. */
export function applyLayerEffect(timeline: Timeline, layer: ReadyLayer, existing: ExistingStack, input: LayerEffectInput, newId: () => string): Applied {
  const clip = baseClip(timeline, layer, input.clipId);
  const grade = (patch: Partial<typeof DEFAULT_COLOR_GRADE>) => ({ ...DEFAULT_COLOR_GRADE, ...clip.colorGrade, ...patch, enabled: true });
  const gradePatch = Object.fromEntries((['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'vibrance'] as const).filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  if (input.effect === 'grade' && !Object.keys(gradePatch).length) throw new Error('grade needs at least one of exposure, contrast, saturation, temperature, tint or vibrance.');
  if ((input.effect === 'glow' || input.effect === 'outline') && input.target) throw new Error('glow and outline always follow the subject; omit target.');
  const subject = (extra: Partial<Clip> = {}) => syncedCopy(clip, newId(), 0, { assetId: layer.outputAssetId, ...extra });
  const plate = (extra: Partial<Clip>) => syncedCopy(clip, newId(), 0, extra);
  let parts: StackParts;
  switch (input.effect) {
    case 'colorOnly':
      parts = { plate: plate({ colorGrade: grade({ saturation: 1 - (input.amount ?? 1) }) }), subject: subject() };
      break;
    case 'grade':
      parts = (input.target ?? 'subject') === 'subject' ? { subject: subject({ colorGrade: grade(gradePatch) }) } : { plate: plate({ colorGrade: grade(gradePatch) }), subject: subject() };
      break;
    case 'blur': {
      const softBlur = { enabled: true, amount: Math.round((input.amount ?? .45) * 40 * 10) / 10 };
      parts = (input.target ?? 'background') === 'background' ? { plate: plate({ softBlur }), subject: subject() } : { subject: subject({ softBlur }) };
      break;
    }
    case 'glow':
    case 'outline': {
      const outline = { enabled: true, color: input.color ?? DEFAULT_OUTLINE.color, width: input.width ?? (input.effect === 'outline' ? DEFAULT_OUTLINE.width : 0), glow: input.glow ?? (input.effect === 'glow' ? DEFAULT_OUTLINE.glow : 0) };
      if (!outline.width && !outline.glow) throw new Error('Give the outline a width or a glow above 0.');
      parts = { subject: subject({ outline }) };
      break;
    }
  }
  const placed = placeStack(timeline, clip, existing, parts);
  const ids = [parts.plate?.id, placed.subject?.id].filter((id): id is string => !!id);
  return { timeline: placed.timeline, baseClipId: clip.id, clipIds: ids, subjectClipIds: placed.subject ? [placed.subject.id] : [] };
}
