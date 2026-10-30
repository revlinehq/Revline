'use client';
import { memo } from 'react';
import { sceneHue } from '@/lib/editor/scene-placeholder';

type Props = { frames?: { time: number; image: string }[]; width: number; height: number; duration: number; aspect: number; title: string; rendering?: boolean };

/** A motion clip's filmstrip: its rendered frames tiled across the clip, each tile showing the nearest frame in time. */
export const SceneFilmstrip = memo(function SceneFilmstrip({ frames, width, height, duration, aspect, title, rendering }: Props) {
  if (width <= 0) return null;
  // No frames yet: a calm grain gradient under the clip's title, shimmering only while its frames render.
  if (!frames?.length) return <div className="scene-placeholder" data-rendering={rendering || undefined} style={{ '--scene-hue': sceneHue(title) } as React.CSSProperties} aria-hidden="true">{rendering && <i/>}</div>;
  const tile = Math.max(16, height * aspect), count = Math.ceil(width / tile);
  return <div className="filmstrip media-filmstrip scene-filmstrip" aria-hidden="true">{Array.from({ length: count }, (_, index) => {
    const time = (index + .5) * tile / width * duration;
    const nearest = frames.reduce((best, frame) => Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best, frames[0]);
    return <div className="filmstrip-frame" key={index} style={{ left: index * tile, width: tile }}><img src={`data:image/jpeg;base64,${nearest.image}`} alt="" draggable={false} /></div>;
  })}</div>;
});
