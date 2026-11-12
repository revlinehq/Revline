'use client';

import { useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FootagePanel, type UploadProgress } from './footage-panel';
import type { VideoImportState } from './video-link-import';
import type { MediaAsset } from '@/lib/editor/types';
import './preview-inspector.css';
import './effects-panel.css';

/** The editor's side panel: the project's media library and, when the editor passes them, the timeline's effects. */
export function PreviewInspector({ assets, onRemoveAsset, onAttachAsset, usedAssetIds, upload, onUpload, onAdd, videoImports, sourceRequest = 0, resumeHint, effects }: { resumeHint?: string; assets: MediaAsset[]; onRemoveAsset?: (asset: MediaAsset) => Promise<void>; onAttachAsset?: (asset: MediaAsset) => void; usedAssetIds?: readonly string[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; videoImports?: VideoImportState[]; sourceRequest?: number; /** The Effects tab's content; without it the panel is the media library alone. */ effects?: ReactNode }) {
  const [tab, setTab] = useState('media');
  const media = <FootagePanel resumeHint={resumeHint} onRemove={onRemoveAsset} onAttach={onAttachAsset} usedAssetIds={usedAssetIds} key={sourceRequest} videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/>;
  if (!effects) return <aside className="preview-inspector" aria-label="Media"><div className="inspector-content inspector-media-content">{media}</div></aside>;
  return <aside className="preview-inspector" aria-label="Media and effects">
    <Tabs className="inspector-tab-root" value={tab} onValueChange={setTab}>
      <TabsList className="inspector-tab-list" aria-label="Media panel">
        <TabsTrigger value="media">Media</TabsTrigger>
        <TabsTrigger value="effects">Effects</TabsTrigger>
      </TabsList>
      <TabsContent value="media" className="inspector-tab-panel inspector-content inspector-media-content">{media}</TabsContent>
      <TabsContent value="effects" className="inspector-tab-panel inspector-content inspector-media-content">{effects}</TabsContent>
    </Tabs>
  </aside>;
}
