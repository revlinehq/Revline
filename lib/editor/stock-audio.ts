import catalog from './stock-audio-catalog.json';
import type { AudioWaveform, MediaAsset } from './types';

export type StockAudio = {
  id: string; name: string; category: string; tags: string[]; pack: string; sourceFile: string; sourceUrl: string; license: string;
  r2Key: string; sha256: string; file: string; contentType: string; duration: number; size: number; waveform: AudioWaveform;
};
export const STOCK_AUDIO_CATALOG: readonly StockAudio[] = catalog;
const byId = new Map(STOCK_AUDIO_CATALOG.map(sound => [sound.id, sound]));
const keys = new Set(STOCK_AUDIO_CATALOG.map(sound => sound.r2Key));
export function stockAudio(id: string) { return byId.get(id); }
export function isStockAudioKey(key: string | undefined): boolean { return !!key && keys.has(key); }
export function stockAudioAsset(id: string): MediaAsset {
  const sound = stockAudio(id);
  if (!sound) throw new Error('Unknown Audio FX sound.');
  return { _id: `stock-audio-${id}`, kind: 'audio', fileName: `${sound.name}.ogg`, url: `/api/audio-fx/${id}`, duration: sound.duration, waveform: sound.waveform };
}
export function isStockAudioAsset(asset: MediaAsset): boolean {
  return !!stockAudio(asset._id.replace(/^stock-audio-/, '')) || ('r2Key' in asset && typeof asset.r2Key === 'string' && isStockAudioKey(asset.r2Key));
}
