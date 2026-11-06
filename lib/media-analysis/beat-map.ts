export const BEAT_ANALYSIS_ENGINE = 'beat-this-final0-v1' as const;

export type AudioHit = { time: number; strength: number };
/** Measured energy each `step` seconds from the start of the source: loudness (LUFS), low band under 150 Hz (dBFS)
 * and how many sounds start. Saved with the beat map so analyzeMusic reads a song without decoding it again. */
export type MusicEnergy = { step: number; loudness: number[]; low: number[]; onsets: number[] };
/** Energy covers at most this much of a source; longer sources are measured up to it. */
export const MAX_MUSIC_ENERGY_SECONDS = 600;
export const MUSIC_ENERGY_STEP = .5;
export type BeatMap = {
  beats: number[];
  bpm: number;
  confidence: number;
  engine?: typeof BEAT_ANALYSIS_ENGINE;
  downbeats?: number[];
  accents?: AudioHit[];
  dropCandidates?: AudioHit[];
  energy?: MusicEnergy;
};
