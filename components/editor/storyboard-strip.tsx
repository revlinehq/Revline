'use client';

import { useMemo, useState } from 'react';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { MediaAsset } from '@/lib/editor/types';
import './storyboard-strip.css';

/** The latest direction pair or board remains visible above the existing composer, including after reload. */
export function StoryboardStrip({ media }: { media: readonly MediaAsset[] }) {
  const [open, setOpen] = useState<MediaAsset | null>(null);
  const frames = useMemo(() => {
    const candidates = media.flatMap(asset => {
      const shot = asset.imageGeneration?.storyboard;
      return asset.kind === 'image' && asset.url && asset.imageGeneration?.purpose === 'storyboard' && shot ? [{ asset, shot }] : [];
    }).sort((a, b) => (a.asset.createdAt ?? 0) - (b.asset.createdAt ?? 0));
    const latest = candidates.at(-1);
    if (!latest) return [];
    const phase = latest.shot.phase ?? 'board';
    return [...new Map(candidates.filter(item => item.shot.name === latest.shot.name && (item.shot.phase ?? 'board') === phase).map(item => [item.shot.shotIndex, item])).values()].sort((a, b) => a.shot.shotIndex - b.shot.shotIndex);
  }, [media]);
  if (!frames.length) return null;
  return <Dialog open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
    <div className="storyboard-image-grid" aria-label={frames[0].shot.phase === 'direction' ? 'Storyboard directions' : 'Storyboard frames'}>
      {frames.map(({ asset, shot }) => <Button key={asset._id} type="button" variant="ghost" className="storyboard-frame h-auto w-full p-0 focus-visible:ring-0 focus-visible:outline-none" aria-label={`Open ${shot.phase === 'direction' ? 'direction' : 'frame'} ${shot.shotIndex}`} onClick={() => setOpen(asset)}>
        <AspectRatio ratio={16 / 9}>
          <img src={asset.url!} alt={`${shot.phase === 'direction' ? 'Direction' : 'Frame'} ${shot.shotIndex}`} loading="lazy"/>
          <Badge variant="secondary" className="storyboard-frame-number">{shot.shotIndex}</Badge>
        </AspectRatio>
      </Button>)}
    </div>
    <DialogContent className="storyboard-image-dialog">
      <DialogTitle className="sr-only">{open?.fileName ?? 'Storyboard frame'}</DialogTitle>
      {open && <img src={open.url!} alt={open.fileName}/>}
    </DialogContent>
  </Dialog>;
}
