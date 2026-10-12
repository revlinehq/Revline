'use client';
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Film } from 'lucide-react';
import { filmstripFrames, filmstripFrameWidth } from '@/lib/editor/filmstrip';
import { cachedVideoThumbnail, videoThumbnails } from '@/lib/editor/video-thumbnails';
import { observeTimelineViewport } from '@/lib/editor/timeline-viewport';
import type { MediaAsset } from '@/lib/editor/types';

type Props = { asset: MediaAsset; width: number; height: number; sourceStart: number; duration: number; timelineStart: number; px: number; fps: number; viewport: RefObject<HTMLDivElement | null>; paused?: boolean };

export const MediaFilmstrip = memo(function MediaFilmstrip({ asset, width, height, sourceStart, duration, timelineStart, px, fps, viewport, paused = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [decoded, setDecoded] = useState<{ sourceId: string; images: Record<number, string> }>({ sourceId: '', images: {} });
  const previousFrames = useMemo(() => decoded.sourceId === asset._id ? Object.entries(decoded.images).map(([time, image]) => ({ time: Number(time), image })) : [], [decoded, asset._id]);
  const frameWidth = imageAspect ? Math.max(16, height * imageAspect) : filmstripFrameWidth(height, asset.width, asset.height);
  useEffect(() => {
    const node = root.current, rail = viewport.current;
    if (!node || !rail) return;
    const observer = observeTimelineViewport(rail, node, (clip, visible) => {
      const intersects = clip.bottom > visible.top && clip.top < visible.bottom;
      const start = intersects ? Math.max(0, Math.floor((visible.left - clip.left) / frameWidth) * frameWidth - frameWidth) : 0;
      const end = intersects ? Math.min(width, Math.ceil((visible.right - clip.left) / frameWidth) * frameWidth + frameWidth) : 0;
      setRange(old => old.start === start && old.end === end ? old : { start, end });
    });
    return observer.unsubscribe;
  }, [frameWidth, width, timelineStart, viewport]);
  const samples = useMemo(() => filmstripFrames({ clipWidth: width, frameWidth, visibleStart: range.start, visibleEnd: range.end, pxPerSecond: px, sourceStart, duration, fps, sourceDuration: asset.duration }), [width, frameWidth, range, px, sourceStart, duration, fps, asset.duration]);
  useEffect(() => {
    if (paused || asset.kind !== 'video' || !asset.url || !samples.length) return;
    let cancelled = false;
    const url = asset.url;
    // Wait for a settled zoom/scroll position before starting more decoder work.
    const timer = setTimeout(() => {
      void videoThumbnails(url, samples.map(frame => frame.time), asset._id, (time, image) => {
        if (cancelled || !image) return;
        setDecoded(old => ({ sourceId: asset._id, images: { ...(old.sourceId === asset._id ? old.images : {}), [time]: image } }));
      }).then(images => {
        if (cancelled) return;
        const next: Record<number, string> = {};
        images.forEach((image, index) => { if (image) next[samples[index].time] = image; });
        setDecoded({ sourceId: asset._id, images: next });
      });
    }, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [asset.kind, asset.url, asset._id, samples, paused]);
  if (!asset.url) return null;
  return <div ref={root} className="filmstrip media-filmstrip" aria-hidden="true">{samples.map(frame => {
    // Keep the nearest already decoded still visible during a trim or zoom refresh.
    const previous = previousFrames.reduce<typeof previousFrames[number] | undefined>((closest, candidate) => !closest || Math.abs(candidate.time - frame.time) < Math.abs(closest.time - frame.time) ? candidate : closest, undefined);
    const image = asset.kind === 'image' ? asset.url! : (decoded.sourceId === asset._id ? decoded.images[frame.time] : undefined) ?? cachedVideoThumbnail(asset._id, frame.time) ?? previous?.image;
    return <div className="filmstrip-frame" data-source-time={frame.time} key={frame.index} style={{ left: frame.left, width: frameWidth }}>{image ? <img src={image} alt="" draggable={false} onLoad={asset.kind === 'image' ? event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setImageAspect(image.naturalWidth / image.naturalHeight); } : undefined} /> : <Film size={12} />}</div>;
  })}</div>;
});
