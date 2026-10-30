'use client';

import { FootagePanel, type UploadProgress } from './footage-panel';
import type { VideoImportState } from './video-link-import';
import type { MediaAsset } from '@/lib/editor/types';
import './preview-inspector.css';

/** The editor's side panel: the project's media library. */
export function PreviewInspector({ assets, onRemoveAsset, onAttachAsset, usedAssetIds, upload, onUpload, onAdd, videoImports, sourceRequest = 0 }: { assets: MediaAsset[]; onRemoveAsset?: (asset: MediaAsset) => Promise<void>; onAttachAsset?: (asset: MediaAsset) => void; usedAssetIds?: readonly string[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; videoImports?: VideoImportState[]; sourceRequest?: number }) {
  return <aside className="preview-inspector" aria-label="My media">
    <div className="inspector-content inspector-media-content"><FootagePanel onRemove={onRemoveAsset} onAttach={onAttachAsset} usedAssetIds={usedAssetIds} key={sourceRequest} variant="library" videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/></div>
  </aside>;
}
