import type { MediaAsset } from './types';
import type { ComposerAttachment } from '@/components/workspace/edit-composer';

/** Only newly attached sources belong here; extracted audio is not a second upload. */
export function composerMedia(assets: readonly MediaAsset[], ids: readonly string[]): ComposerAttachment[] {
  const selected = new Set(ids);
  return assets.filter(asset => selected.has(asset._id)).map(asset => ({
    id: asset._id, name: asset.fileName,
    kind: asset.thumbnailUrl ? 'image' : asset.kind,
    url: asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.url ?? undefined : undefined),
    progress: asset.footageProgress!==undefined&&asset.footageProgress<90?asset.footageProgress:undefined,
    error: asset.preparation?.status === 'failed' ? asset.preparation.message : undefined,
  }));
}
