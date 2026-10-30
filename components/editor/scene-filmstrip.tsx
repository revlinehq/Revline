'use client';
import { memo } from 'react';

type Props = { frames: { time: number; image: string }[]; width: number; height: number; duration: number; aspect: number };

/** A motion clip's filmstrip: its rendered frames tiled across the clip, each tile showing the nearest frame in time. */
export const SceneFilmstrip = memo(function SceneFilmstrip({ frames, width, height, duration, aspect }: Props) {
  if (!frames.length || width <= 0) return null;
  const tile = Math.max(16, height * aspect), count = Math.ceil(width / tile);
  return <div className="filmstrip media-filmstrip scene-filmstrip" aria-hidden="true">{Array.from({ length: count }, (_, index) => {
    const time = (index + .5) * tile / width * duration;
    const nearest = frames.reduce((best, frame) => Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best, frames[0]);
    return <div className="filmstrip-frame" key={index} style={{ left: index * tile, width: tile }}><img src={`data:image/jpeg;base64,${nearest.image}`} alt="" draggable={false} /></div>;
  })}</div>;
});
