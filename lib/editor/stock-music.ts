import catalog from './stock-music-catalog.json';
import type { AudioWaveform } from './types';
import type { AudioHit } from '../media-analysis/beat-map';

// Mixkit tracks suited to launch and product films, with each one's beat map measured by Beat This
// (scripts/detect-beats.py) and its waveform. The files stay on Mixkit: a track is copied into a project's own
// storage only when an agent picks it, never served from Revline as a library.

export const MIXKIT_LICENSE = { name: 'Mixkit Free License', url: 'https://mixkit.co/license/#musicFree' } as const;
/** Mixkit's asset host answers only requests that come from its own pages. */
export const MIXKIT_REFERER = 'https://mixkit.co/';

export type StockMusic = {
  id: string; mixkitId: number; title: string; artist: string; genre: string; tags: string[];
  bpm: number; confidence: number; level: number; dynamics: number; duration: number; url: string;
  beats: number[]; downbeats: number[]; accents: AudioHit[]; waveform: AudioWaveform; license: typeof MIXKIT_LICENSE.name;
};
export const STOCK_MUSIC_CATALOG: readonly StockMusic[] = catalog.map(track => ({ ...track, license: MIXKIT_LICENSE.name }));
const byId = new Map(STOCK_MUSIC_CATALOG.map(track => [track.id, track]));
export function stockMusic(id: string) { return byId.get(id); }
/** The clip name carries the credit: title and artist, and where it is from. */
export function stockMusicFileName(track: StockMusic) { return `${track.title} - ${track.artist} (Mixkit).mp3`.replace(/[\\/:*?"<>|]/g, ''); }
