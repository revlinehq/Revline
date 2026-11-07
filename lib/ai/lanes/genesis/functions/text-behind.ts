import { z } from 'zod';
import { TEXT_FONTS } from '../../../../editor/text-fonts';
import { dimensions, type Clip, type Timeline } from '../../../../editor/types';
import { baseClip, hexColor, placeStack, syncedCopy, type Applied, type ExistingStack, type ReadyLayer } from './layer';

const FONT_IDS = TEXT_FONTS.map(font => font.id) as [Clip['fontFamily'] & string, ...(Clip['fontFamily'] & string)[]];

export const textBehindInput = z.object({
  layerId: z.string().min(1),
  clipId: z.string().min(1).optional().describe('Footage clip; defaults to the clip the layer was segmented from.'),
  text: z.string().trim().min(1).max(80),
  color: z.string().regex(hexColor).optional().describe('Six-digit hex, default #FFFFFF.'),
  fontSize: z.number().int().min(24).max(400).optional().describe('px at the canvas size; default fills ~90% of the width on one line.'),
  fontFamily: z.enum(FONT_IDS).optional(),
  x: z.number().min(0).max(1).optional().describe('Text centre, canvas fraction (default .5).'),
  y: z.number().min(0).max(1).optional().describe('Text centre, canvas fraction (default .3: behind the head and shoulders).'),
  animation: z.enum(['none', 'fade', 'rise']).optional().describe('Entrance; default rise.'),
  start: z.number().min(0).optional().describe('TIMELINE second the title appears; default the clip start.'),
  end: z.number().positive().optional().describe('TIMELINE second it ends; default the clip end.'),
}).strict();
export type TextBehindInput = z.infer<typeof textBehindInput>;

export const textBehindDescription = "Genesis (MCP only). Put a title between the background and a ready SAM 3.1 layer: the footage (and any colour/blur plate) stays below, the text goes above it, and the transparent subject cut-out (synced copy, reused if one is already there) goes on top, so the subject covers the letters it overlaps every frame. Props: text (1-80), color, fontSize, fontFamily, x, y, animation, start/end inside the clip. Preview and export draw the same saved masks. Returns textClipId and subjectClipId. Check with getFrames where the subject overlaps the text.";

export function applyTextBehind(timeline: Timeline, layer: ReadyLayer, existing: ExistingStack, input: TextBehindInput, newId: () => string): Applied & { textClipId: string } {
  const clip = baseClip(timeline, layer, input.clipId);
  const start = input.start ?? clip.start, end = input.end ?? clip.start + clip.duration;
  if (start < clip.start - 1e-6 || end > clip.start + clip.duration + 1e-6 || end - start < 1 / timeline.fps) throw new Error(`Keep the title inside clip ${clip.id} (${clip.start.toFixed(2)}–${(clip.start + clip.duration).toFixed(2)}s).`);
  // One line across ~90% of the frame: bold caps run about 0.62em per character.
  const fontSize = input.fontSize ?? Math.max(48, Math.min(190, Math.floor(dimensions(timeline.aspectRatio).width * .9 / (.62 * input.text.length))));
  const text: Clip = { id: newId(), kind: 'graphic', track: 0, start, duration: end - start, sourceStart: 0, text: input.text, fontSize, color: input.color ?? '#FFFFFF', background: 'transparent', x: input.x ?? .5, y: input.y ?? .3, animation: input.animation ?? 'rise', ...(input.fontFamily ? { fontFamily: input.fontFamily } : {}) };
  // Reuses a plain subject copy already on top of this footage (e.g. from colorOnly) instead of stacking a second one.
  const placed = placeStack(timeline, clip, existing, { text, subject: syncedCopy(clip, newId(), 0, { assetId: layer.outputAssetId }) });
  const subjectClipId = placed.subject!.id;
  return { timeline: placed.timeline, baseClipId: clip.id, clipIds: [text.id, subjectClipId], subjectClipIds: [subjectClipId], textClipId: text.id };
}
