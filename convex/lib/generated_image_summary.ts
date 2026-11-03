import type { Doc } from '../_generated/dataModel';

/** Agent-facing provenance for a generated scene asset. Historical fields remain stored unchanged. */
export function generatedImageSummary(asset: Pick<Doc<'assets'>, 'imageGeneration'>) {
  const generation = asset.imageGeneration;
  return generation ? { generation: { model: generation.model, quality: generation.quality, requestId: generation.requestId, estimatedUsd: generation.usage.estimatedUsd } } : {};
}
