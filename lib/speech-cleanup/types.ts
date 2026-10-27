/** A transcribed word in SOURCE seconds. Fillers ("um", "uh") may or may not be present. */
export type SpeechWord = { text: string; start: number; end: number };

export type CleanupKind = 'pause' | 'breath' | 'filler' | 'restart';

/** One stretch of source audio the engine proposes to remove, with why. */
export type CleanupCut = {
  kind: CleanupKind;
  start: number;
  end: number;
  /** 0..1: how sure the evidence is. Callers can skip low-confidence cuts. */
  confidence: number;
  /** Removed words for restarts; a short description for acoustic cuts. */
  detail: string;
};

export type CleanupOptions = {
  /** Shortest pause worth removing, seconds. Shorter gaps read as natural rhythm. */
  minPause: number;
  /** Silence left on each side of a cut so speech never sounds clipped. */
  pad: number;
  /** Longest gap between a phrase and its repeat that still counts as a restart. */
  restartWindow: number;
};

export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = { minPause: .35, pad: .06, restartWindow: 8 };
