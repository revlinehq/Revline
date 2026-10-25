import type { Clip } from './types';

/** Each video/audio clip loads its media through its own URL. Chrome shares one
 * network stream between media elements with an identical URL; when one of them
 * pauses or cancels that stream (a finished cut, the preloader), the next cut of
 * the same file can wait on it forever. The media worker ignores the extra
 * parameter. Blob URLs and local export paths are left alone. */
export function clipMediaUrl(url: string, clip: Pick<Clip, 'id' | 'kind'>) {
  if ((clip.kind !== 'video' && clip.kind !== 'audio') || !/^https?:/i.test(url)) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('clip', clip.id);
  return parsed.toString();
}
