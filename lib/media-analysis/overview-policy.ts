import type { MediaAsset } from '../editor/types';

/** Roughly one transcribed word per four source seconds is meaningful speech. */
export function shouldUnderstandFootage(asset: Pick<MediaAsset, 'kind' | 'duration' | 'audioExtracted' | 'analysis'>) {
  if (asset.kind !== 'video' || !asset.audioExtracted || !asset.duration || !Number.isFinite(asset.duration) || asset.duration <= 0 || asset.analysis?.understanding) return false;
  const transcript = asset.analysis?.transcript;
  if (!transcript) return false;
  const words = transcript.words.filter(word => /[\p{L}\p{N}]/u.test(word.text)).length;
  return words < Math.max(1, Math.ceil(asset.duration / 4));
}
