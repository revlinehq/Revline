import type { Doc } from '../_generated/dataModel';
type Generation = NonNullable<Doc<'assets'>['imageGeneration']>;
type Summary = { purpose?: 'asset' | 'storyboard'; referenceOnly?: boolean; storyboard?: NonNullable<Generation['storyboard']> & { phase: 'direction' | 'board'; line: string }; generation?: Pick<Generation, 'model' | 'quality' | 'requestId'> & Pick<Generation['usage'], 'estimatedUsd'> };

/** Small, shared project/inspection metadata; prompts and original PNGs stay on the asset. */
export function generatedImageSummary(asset: Pick<Doc<'assets'>, 'imageGeneration'>): Summary {
  const generation = asset.imageGeneration;
  if (!generation) return {};
  const purpose = generation.purpose ?? 'asset', shot = generation.storyboard;
  const storyboard = shot ? { ...shot, phase: shot.phase ?? 'board', line: `${shot.phase === 'direction' ? 'Direction' : 'Frame'} ${shot.shotIndex} · ${shot.idea} · ${shot.motion}${shot.transition ? ` → ${shot.transition}` : ''}` } : undefined;
  return { purpose, referenceOnly: purpose === 'storyboard', ...(storyboard ? { storyboard } : {}), generation: { model: generation.model, quality: generation.quality, requestId: generation.requestId, estimatedUsd: generation.usage.estimatedUsd } };
}
