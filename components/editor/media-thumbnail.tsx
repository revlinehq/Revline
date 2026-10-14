'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, Image as ImageIcon, Music2 } from 'lucide-react';
import type { MediaAsset } from '@/lib/editor/types';
import './media-thumbnail.css';

/** Metadata-only videos load once visible; no autoplay or extra decoding while browsing rows. */
export function MediaThumbnail({ asset, className = '' }: { asset: Pick<MediaAsset, 'kind' | 'url' | 'thumbnailUrl'>; className?: string }) {
  const host=useRef<HTMLSpanElement>(null);
  const [videoVisible,setVideoVisible]=useState(false);
  useEffect(()=>{
    if(asset.kind!=='video'||asset.thumbnailUrl||videoVisible)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVideoVisible(true);observer.disconnect();}},{rootMargin:'120px'});
    if(host.current)observer.observe(host.current);
    return()=>observer.disconnect();
  },[asset.kind,asset.thumbnailUrl,videoVisible]);
  return <span ref={host} className={`media-thumbnail ${className}`} aria-hidden="true">{asset.thumbnailUrl||asset.url&&asset.kind==='image'?<img src={asset.thumbnailUrl??asset.url!} alt="" loading="lazy"/>:asset.url&&asset.kind==='video'&&videoVisible?<video src={`${asset.url}#t=.1`} muted playsInline preload="metadata"/>:asset.kind==='audio'?<Music2 size={25}/>:asset.kind==='image'?<ImageIcon size={25}/>:<Film size={25}/>}</span>;
}
