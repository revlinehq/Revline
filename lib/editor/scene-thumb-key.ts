import type { Clip, Timeline } from './types';

/** What a motion clip's frames depend on, hashed (FNV-1a), from the stored timeline: code is stored by hash, so its ref stands in for it.
 *  The editor and the backend both compute it, so the editor can ask for one clip's frames without the backend reading the project. */
export function sceneThumbKey(clip: Clip, timeline: Pick<Timeline, 'aspectRatio' | 'fps'>) {
  const scene = clip.scene!, ref = (item: { code: string; codeRef?: string }) => item.codeRef ?? item.code;
  const text = JSON.stringify([ref(scene), (scene.blueprints ?? []).map(ref), scene.media, scene.brand, scene.film, clip.duration, clip.sourceStart, timeline.aspectRatio, timeline.fps]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${clip.id}:${(hash >>> 0).toString(36)}`;
}
