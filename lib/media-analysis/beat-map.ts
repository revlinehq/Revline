export const BEAT_ANALYSIS_ENGINE = 'beat-this-final0-v1' as const;

export type AudioHit = { time: number; strength: number };
export type BeatMap = {
  beats: number[];
  bpm: number;
  confidence: number;
  engine?: typeof BEAT_ANALYSIS_ENGINE;
  downbeats?: number[];
  accents?: AudioHit[];
  dropCandidates?: AudioHit[];
};
