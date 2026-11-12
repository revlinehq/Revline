'use client';

import type { ReactNode } from 'react';
import { ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FootagePanel, type UploadProgress } from './footage-panel';
import type { SidePanelTab } from './panel-rail';
import type { VideoImportState } from './video-link-import';
import type { MediaAsset } from '@/lib/editor/types';
import './preview-inspector.css';
import './effects-panel.css';

/** The editor's side panel: the project's media and, when the editor passes them, the timeline's effects.
 *  On desktop the rail beside it picks the tab and the panel shows that tab under its title; in the phone sheet the two
 *  tabs are a segmented control at the top. */
export function PreviewInspector({ assets, onRemoveAsset, onAttachAsset, usedAssetIds, upload, onUpload, onImportLink, onAdd, videoImports, sourceRequest = 0, resumeHint, effects, tab, onTabChange, onClose, sheet = false }: { resumeHint?: string; assets: MediaAsset[]; onRemoveAsset?: (asset: MediaAsset) => Promise<void>; onAttachAsset?: (asset: MediaAsset) => void; usedAssetIds?: readonly string[]; upload: UploadProgress; onUpload: () => void; onImportLink?: () => void; onAdd: (asset: MediaAsset) => void; videoImports?: VideoImportState[]; sourceRequest?: number;
  /** The Effects tab's content; without it the panel is the media library alone. */ effects?: ReactNode;
  tab: SidePanelTab; onTabChange: (tab: SidePanelTab) => void; onClose?: () => void;
  /** Inside the phone sheet: segmented tabs, no title row. */ sheet?: boolean }) {
  const media = <FootagePanel resumeHint={resumeHint} onRemove={onRemoveAsset} onAttach={onAttachAsset} usedAssetIds={usedAssetIds} key={sourceRequest} videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onImportLink={onImportLink} onAdd={onAdd}/>;
  const current = effects ? tab : 'media';
  if (!sheet || !effects) return <aside className="preview-inspector" aria-label={current === 'media' ? 'Media' : 'Effects'}>
    {!sheet && <header className="inspector-head">
      <h2>{current === 'media' ? 'Media' : 'Effects'}</h2>
      {onClose && <Button type="button" variant="ghost" size="icon-sm" className="inspector-head-close" aria-label="Close side panel" title="Close side panel" onClick={onClose}><ChevronsRight size={18} strokeWidth={1.5}/></Button>}
    </header>}
    <div className="inspector-content inspector-media-content" data-tab={current}>{current === 'media' ? media : effects}</div>
  </aside>;
  return <aside className="preview-inspector" aria-label="Media and effects">
    <Tabs className="inspector-tab-root" value={current} onValueChange={value => onTabChange(value as SidePanelTab)}>
      <TabsList className="inspector-tab-list" aria-label="Side panel">
        <TabsTrigger value="media">Media</TabsTrigger>
        <TabsTrigger value="effects">Effects</TabsTrigger>
      </TabsList>
      <TabsContent value="media" className="inspector-tab-panel inspector-content inspector-media-content" data-tab="media">{media}</TabsContent>
      <TabsContent value="effects" className="inspector-tab-panel inspector-content inspector-media-content" data-tab="effects">{effects}</TabsContent>
    </Tabs>
  </aside>;
}
