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
  /** How far ahead (seconds) a re-recorded sentence is looked for. */
  retakeWindow: number;
};

export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = { minPause: .15, pad: .05, restartWindow: 8, retakeWindow: 60 };

/** Bump when detection changes enough that saved maps should be measured again. */
export const SPEECH_CLEANUP_VERSION = 1;
export const MAX_CLEANUP_CUTS = 2000;
export const MAX_CLEANUP_DETAIL = 200;

/** A source's saved cleanup map, stored with its transcript. */
/** `edges` holds each transcript word's measured sound start and decay end, flattened as
 * [start0, end0, start1, end1, …] in transcript word order; joins snap to them. */
export type SpeechCleanup = { version: number; cuts: CleanupCut[]; edges?: number[] };
