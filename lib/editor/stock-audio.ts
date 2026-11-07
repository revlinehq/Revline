import catalog from './stock-audio-catalog.json';
import type { AudioWaveform } from './types';

export type StockAudio = {
  id: string; name: string; category: string; tags: string[]; pack: string; sourceFile: string; sourceUrl: string; license: string;
  creator?: string; r2Key: string; sha256: string; file: string; contentType: string; duration: number; size: number; waveform: AudioWaveform;
};
export const STOCK_AUDIO_CATALOG: readonly StockAudio[] = catalog;
export const STOCK_AUDIO_IDS = STOCK_AUDIO_CATALOG.map(sound => sound.id) as [string, ...string[]];
const byId = new Map(STOCK_AUDIO_CATALOG.map(sound => [sound.id, sound]));
const keys = new Set(STOCK_AUDIO_CATALOG.map(sound => sound.r2Key));
export function stockAudio(id: string) { return byId.get(id); }
export function isStockAudioKey(key: string | undefined): boolean { return !!key && keys.has(key); }
