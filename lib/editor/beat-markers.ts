import type { BeatMap } from '../media-analysis/beat-map';
import type { Timeline, TimelineMarker } from './types';
import { sourceEndOf, timelineTimeAtSource, validatePlaybackRate } from './playback-rate';

export type BeatMarkerKind = 'beats' | 'downbeats' | 'accents' | 'dropCandidates';
export type BeatMarkerRange = { start?: number; end?: number; kind?: BeatMarkerKind };
export type BeatMarkerResult = {
  timeline: Timeline;
  added: number;
  skipped: number;
  confidence: number | null;
  status: 'added' | 'already-marked' | 'unavailable' | 'no-beats' | 'low-confidence' | 'no-beats-in-range';
  message: string;
};

function clipKey(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

/** Map measured source events to one audio clip. Range endpoints are timeline seconds, [start, end). */
export function addBeatMarkers(timeline: Timeline, clipId: string, analysis: BeatMap | undefined, range: BeatMarkerRange = {}): BeatMarkerResult {
  const clip = timeline.clips.find(candidate => candidate.id === clipId);
  if (!clip || clip.kind !== 'audio') throw new Error('Choose an audio clip on this timeline to mark its beats.');
  if (![24, 30, 60].includes(timeline.fps)) throw new Error('Beat markers require a timeline at 24, 30, or 60 fps.');
  validatePlaybackRate(clip);
  if (![clip.start, clip.duration, clip.sourceStart, clip.start + clip.duration, sourceEndOf(clip)].every(Number.isFinite) || clip.start < 0 || clip.duration <= 0 || clip.sourceStart < 0) throw new Error('The audio clip has invalid timing.');
  if ([range.start, range.end].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)) || (range.start !== undefined && range.end !== undefined && range.end <= range.start)) throw new Error('Choose a finite, nonnegative timeline range with end after start.');

  const unchanged = (status: BeatMarkerResult['status'], message: string): BeatMarkerResult => ({ timeline, added: 0, skipped: 0, confidence: analysis?.confidence ?? null, status, message });
  if (!analysis) return unchanged('unavailable', 'No measured beat analysis is available for this audio source. Analyze its beats first.');
  const kind = range.kind ?? 'beats';
  const names = { beats: { label: 'Beat', description: 'musical beats' }, downbeats: { label: 'Bar', description: 'bar starts' }, accents: { label: 'Hit', description: 'prominent audio hits' }, dropCandidates: { label: 'Possible drop', description: 'energy-rise candidates' } };
  if (!(kind in names)) throw new Error('Choose beats, downbeats, accents, or dropCandidates.');
  const eventName = names[kind];
  const events = kind === 'accents' || kind === 'dropCandidates' ? analysis[kind]?.map(hit => hit.time) : analysis[kind];
  if (!events) return unchanged('unavailable', `No measured ${eventName.description} are available. Analyze this audio source again.`);
  if (!Number.isFinite(analysis.confidence) || analysis.confidence < 0 || analysis.confidence > 1 || events.some(time => !Number.isFinite(time) || time < 0)) throw new Error('The saved beat analysis is invalid. Analyze this audio source again.');
  if (!events.length) return unchanged('no-beats', `No ${eventName.description} were detected; no markers were added.`);
  // Hit strength and energy rises are measured independently of musical pulse confidence.
  if ((kind === 'beats' || kind === 'downbeats') && analysis.confidence <= .15) return unchanged('low-confidence', 'Beat detection confidence is too low to mark reliably; no markers were added.');

  const start = Math.max(clip.start, range.start ?? clip.start);
  const end = Math.min(clip.start + clip.duration, range.end ?? clip.start + clip.duration);
  const frames: number[] = [];
  for (const beat of events) {
    if (beat < clip.sourceStart || beat >= sourceEndOf(clip)) continue;
    const time = timelineTimeAtSource(clip, beat);
    if (time < start || time >= end) continue;
    const frame = Math.round(time * timeline.fps);
    if (!Number.isSafeInteger(frame)) throw new Error('The audio timing is too large to represent as timeline frames.');
    // Rounding near a trim/range boundary must never place a marker outside it.
    const snappedTime = frame / timeline.fps;
    if (snappedTime >= start && snappedTime < end) frames.push(frame);
  }
  if (!frames.length) return unchanged('no-beats-in-range', `No measured ${eventName.description} fall inside this audio clip and timeline range.`);
  frames.sort((a, b) => a - b);

  const existing = timeline.markers ?? [];
  // Another kind of music marker on the same frame does not block this one: a bar start is also a beat, and scene code
  // reads each kind on its own (downbeat(n) next to beat(n)). A beat may also land on a film section's start.
  // Cues and markers of this kind still do.
  const otherKinds = (['beats', 'downbeats', 'accents', 'dropCandidates'] as const).filter(other => other !== kind).map(other => `${other}:`);
  const occupied = new Set(existing.filter(marker => marker.kind !== 'section' && !otherKinds.some(prefix => marker.id.startsWith(prefix))).map(marker => Math.round(marker.time * timeline.fps)));
  const ids = new Set(existing.map(marker => marker.id));
  const labels = new Set(existing.map(marker => marker.label));
  const added: TimelineMarker[] = [];
  let number = 1;
  let skipped = 0;
  const prefix = `${kind}:${clipKey(clip.id)}:${timeline.fps}:`;
  for (const frame of frames) {
    if (occupied.has(frame - 1) || occupied.has(frame) || occupied.has(frame + 1)) { skipped++; continue; }
    const baseId = prefix + frame.toString(36);
    let id = baseId;
    let suffix = 1;
    while (ids.has(id)) id = `${baseId}:${suffix++}`;
    while (labels.has(`${eventName.label} ${number}`)) number++;
    const label = `${eventName.label} ${number++}`;
    added.push({ id, time: frame / timeline.fps, label });
    occupied.add(frame);
    ids.add(id);
    labels.add(label);
  }
  return {
    timeline: added.length ? { ...timeline, markers: [...existing, ...added] } : timeline,
    added: added.length,
    skipped,
    confidence: analysis.confidence,
    status: added.length ? 'added' : 'already-marked',
    message: added.length ? `Added ${added.length} markers at measured ${eventName.description}. ${kind === 'dropCandidates' ? 'These are candidates to check by ear, not verified musical drops.' : 'These do not identify musical drops.'}` : `The measured ${eventName.description} already have nearby markers; no markers were added.`,
  };
}
