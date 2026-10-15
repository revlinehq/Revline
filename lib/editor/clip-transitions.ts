import type { Clip, Timeline } from './types';
import { trackOf } from './types';
import { playbackRateOf } from './playback-rate';

export const TRANSITION_PRESETS = ['crossfade', 'spin-zoom', 'blur-dissolve', 'gradient-wipe', 'iris-wipe'] as const;
export type TransitionPreset = typeof TRANSITION_PRESETS[number];
export const TRANSITION_DIRECTIONS = ['clockwise', 'counter-clockwise'] as const;
export type TransitionDirection = typeof TRANSITION_DIRECTIONS[number];
export const WIPE_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export const IRIS_SHAPES = ['circle', 'ellipse'] as const;
export type TransitionWipeSettings = { wipeDirection: typeof WIPE_DIRECTIONS[number]; softness: number; centerX: number; centerY: number; shape: typeof IRIS_SHAPES[number] };
export type ClipTransition = { fromClipId: string; toClipId: string; direction: TransitionDirection } & Partial<TransitionWipeSettings>;
export const DEFAULT_TRANSITION_WIPE: TransitionWipeSettings = { wipeDirection: 'right', softness: .12, centerX: .5, centerY: .5, shape: 'circle' };
export function transitionWipeSettings(settings: Partial<ClipTransition>): TransitionWipeSettings {
  return { wipeDirection: settings.wipeDirection ?? DEFAULT_TRANSITION_WIPE.wipeDirection, softness: settings.softness ?? DEFAULT_TRANSITION_WIPE.softness, centerX: settings.centerX ?? DEFAULT_TRANSITION_WIPE.centerX, centerY: settings.centerY ?? DEFAULT_TRANSITION_WIPE.centerY, shape: settings.shape ?? DEFAULT_TRANSITION_WIPE.shape };
}
export const DEFAULT_TRANSITION_DURATION = .6;
export const DEFAULT_TRANSITION_DIRECTION: TransitionDirection = 'clockwise';
const tolerance = 1e-6;
const isMedia = (clip: Clip) => clip.kind === 'video' || clip.kind === 'image';
class TransitionBlendError extends Error {}
export function isTransitionPreset(preset: unknown): preset is TransitionPreset { return TRANSITION_PRESETS.includes(preset as TransitionPreset); }
export function isTransitionClip(clip: Clip) { return clip.kind === 'effect' && isTransitionPreset(clip.effectPreset); }

export function validateTransitionSettings(clip: Clip) {
  if (!isTransitionClip(clip)) {
    if (clip.transition !== undefined) throw new Error('Transition settings belong to transition FX clips.');
    return;
  }
  const settings = clip.transition;
  if (!settings || !settings.fromClipId || !settings.toClipId || settings.fromClipId === settings.toClipId || !TRANSITION_DIRECTIONS.includes(settings.direction)) throw new Error('Choose two distinct transition clips and a supported direction.');
  for (const key of ['softness', 'centerX', 'centerY'] as const) if (settings[key] !== undefined && (!Number.isFinite(settings[key]) || settings[key]! < 0 || settings[key]! > 1)) throw new Error('Transition softness and center must be finite values between 0 and 1.');
  if (settings.wipeDirection !== undefined && !WIPE_DIRECTIONS.includes(settings.wipeDirection)) throw new Error('Choose a supported wipe direction.');
  if (settings.shape !== undefined && !IRIS_SHAPES.includes(settings.shape)) throw new Error('Choose a circle or ellipse iris.');
  if (clip.motion?.length || (clip.motionOffset !== undefined && clip.motionOffset !== 0)) throw new Error('Transitions use their own presentation, not motion keyframes.');
}

export function transitionPair(clips: Clip[], settings: Pick<ClipTransition, 'fromClipId' | 'toClipId'>) {
  const from = clips.find(clip => clip.id === settings.fromClipId), to = clips.find(clip => clip.id === settings.toClipId);
  if (!from || !to || from.id === to.id || !isMedia(from) || !isMedia(to) || trackOf(from) !== trackOf(to)) throw new Error('A transition needs neighboring video or image clips on the same V track.');
  const cut = from.start + from.duration;
  if (Math.abs(cut - to.start) > tolerance) throw new Error('Transition clips must meet at a cut without a gap or overlap.');
  if ((from.blendMode ?? 'normal') !== (to.blendMode ?? 'normal')) throw new TransitionBlendError('Transition clips must use the same blend mode.');
  return { from, to, cut, track: trackOf(from) };
}

/** Only real media joins are candidates; captions and other V layers stay independent. */
function transitionCandidates(clips: Clip[], at: number, options: { aboveClipId?: string; visualTrack?: number } = {}) {
  if (!Number.isFinite(at) || at < 0) throw new Error('Choose a valid transition position.');
  const target = options.aboveClipId ? clips.find(clip => clip.id === options.aboveClipId) : undefined;
  if (options.aboveClipId && (!target || !isMedia(target))) throw new Error('Choose a video or image next to the transition cut.');
  const candidates: ReturnType<typeof transitionPair>[] = [];
  let firstError: unknown;
  const tracks = new Map<number, Clip[]>();
  for (const clip of clips) if (isMedia(clip) && (options.visualTrack === undefined || trackOf(clip) === options.visualTrack)) {
    const track = trackOf(clip); tracks.set(track, [...(tracks.get(track) ?? []), clip]);
  }
  for (const members of tracks.values()) {
    members.sort((a,b)=>a.start-b.start);
    for (let index=1;index<members.length;index++) {
      const from=members[index-1],to=members[index];
      if (Math.abs(from.start + from.duration - to.start) > tolerance) continue;
      if (target && from.id !== target.id && to.id !== target.id) continue;
      try { candidates.push(transitionPair(clips, { fromClipId: from.id, toClipId: to.id })); }
      catch (error) { firstError ??= error; }
    }
  }
  candidates.sort((a, b) => Math.abs(a.cut - at) - Math.abs(b.cut - at) || b.track - a.track || a.cut - b.cut);
  if (!candidates.length) throw firstError ?? new Error('Add neighboring video or image clips on one V track before adding a transition.');
  return candidates;
}
export function nearestTransitionPair(clips: Clip[], at: number, options: { aboveClipId?: string; visualTrack?: number } = {}) { return transitionCandidates(clips,at,options)[0]; }

export function maxTransitionDuration(from: Clip, to: Clip, fps: number) { return Math.floor((2 * Math.min(from.duration, to.duration) + tolerance) * fps) / fps; }
export function centeredTransitionRange(from: Clip, to: Clip, fps: number, requested = DEFAULT_TRANSITION_DURATION) {
  if (!Number.isFinite(requested) || requested < 2 / fps - tolerance) throw new Error('A transition must last at least two frames.');
  const duration = Math.min(Math.round(requested * fps) / fps, maxTransitionDuration(from, to, fps));
  if (duration < 2 / fps - tolerance) throw new Error('Both clips need at least one retained frame for a transition.');
  return { start: from.start + from.duration - duration / 2, duration };
}

function centeredDurationLimit(timeline: Pick<Timeline,'clips'|'fps'>, from: Clip, to: Clip, excludeId?: string) {
  const cut=from.start+from.duration,track=trackOf(from);
  let maximum=maxTransitionDuration(from,to,timeline.fps);
  for(const other of timeline.clips){
    if(!isTransitionClip(other)||other.id===excludeId||transitionPair(timeline.clips,other.transition!).track!==track)continue;
    const end=other.start+other.duration;
    maximum=Math.min(maximum,end<=cut+tolerance?2*(cut-end):other.start>=cut-tolerance?2*(other.start-cut):0);
  }
  return Math.max(0,Math.floor((maximum+tolerance)*timeline.fps)/timeline.fps);
}
/** Duration controls keep this exact pair/cut and stop before the next transition band. */
export function transitionDurationLimit(timeline: Pick<Timeline,'clips'|'fps'>, clip: Clip) {
  const {from,to}=transitionPair(timeline.clips,clip.transition!);
  return centeredDurationLimit(timeline,from,to,clip.id);
}
export function boundedTransitionRange(timeline: Pick<Timeline,'clips'|'fps'>, from: Clip, to: Clip, requested = DEFAULT_TRANSITION_DURATION, excludeId?: string) {
  const maximum=centeredDurationLimit(timeline,from,to,excludeId);
  if(maximum<2/timeline.fps-tolerance)throw new Error('Transition ranges on the same V track cannot overlap.');
  return centeredTransitionRange(from,to,timeline.fps,Math.min(requested,maximum));
}

export type TransitionPlacementOptions = { aboveClipId?: string; visualTrack?: number; duration?: number; excludeId?: string };
/** Choose the nearest usable cut, skipping occupied or otherwise invalid neighboring cuts. */
export function findTransitionPlacement(timeline: Pick<Timeline,'clips'|'fps'>, at: number, options: TransitionPlacementOptions = {}) {
  const candidates=transitionCandidates(timeline.clips,at,options),clips=timeline.clips.filter(clip=>clip.id!==options.excludeId);
  let firstError: unknown;
  let probeId='transition-placement';while(clips.some(clip=>clip.id===probeId))probeId+='-';
  for(const pair of candidates)try{
    const range=boundedTransitionRange(timeline,pair.from,pair.to,options.duration,options.excludeId);
    const probe:Clip={id:probeId,kind:'effect',sourceStart:0,effectPreset:'crossfade',...range,transition:{fromClipId:pair.from.id,toClipId:pair.to.id,direction:DEFAULT_TRANSITION_DIRECTION}};
    transitionSources([...clips,probe],timeline.fps);
    return {...pair,...range};
  }catch(error){firstError??=error;}
  throw firstError;
}
export function transitionAvailability(timeline: Pick<Timeline,'clips'|'fps'>, at: number, options: TransitionPlacementOptions = {}) {
  try{return {available:true as const,placement:findTransitionPlacement(timeline,at,options)};}
  catch(error){return {available:false as const,reason:error instanceof Error?error.message:'No transition can be placed at this cut.'};}
}

/** Native source time stays inside the retained range, including non-unit speed. */
export function transitionSampleTime(clip: Clip, time: number, fps: number) {
  return clip.sourceStart + Math.max(0, Math.min(Math.max(0, clip.duration - 1 / fps), time - clip.start)) * playbackRateOf(clip);
}

/** Shared by persistence and the actual preview/export presentation runtime. */
export function transitionSources(clips: Clip[], fps: number) {
  const sources = clips.flatMap((clip, index) => {
    validateTransitionSettings(clip);
    if (!isTransitionClip(clip)) return [];
    const pair = transitionPair(clips, clip.transition!), end = clip.start + clip.duration;
    if (![clip.start, clip.duration, end].every(Number.isFinite) || clip.duration < 2 / fps - tolerance || clip.start < pair.from.start - tolerance || end > pair.to.start + pair.to.duration + tolerance || pair.cut - clip.start < 1 / fps - tolerance || end - pair.cut < 1 / fps - tolerance) throw new Error('A transition must span its cut and stay within both retained clips.');
    if (clips.some(other => other.id !== pair.from.id && other.id !== pair.to.id && other.kind !== 'audio' && other.kind !== 'effect' && trackOf(other) === pair.track && other.start < end - tolerance && clip.start < other.start + other.duration - tolerance)) throw new Error('The transition range overlaps another clip on its V track.');
    return [{ clip, ...pair, index }];
  });
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
    const a = sources[i], b = sources[j];
    if (a.track === b.track && a.clip.start < b.clip.start + b.clip.duration - tolerance && b.clip.start < a.clip.start + a.clip.duration - tolerance) throw new Error('Transition ranges on the same V track cannot overlap.');
  }
  return sources;
}

/** Pair edits carry their transition with the cut, or remove it when the join disappears. */
export function reconcileTransitionEdits(before: Timeline, next: Timeline): Timeline {
  const previous = new Map(before.clips.filter(isTransitionClip).map(clip => [clip.id, clip]));
  if (!previous.size) return next;
  let changed = false;
  const clips = next.clips.flatMap(clip => {
    const old = previous.get(clip.id);
    if (!old || !isTransitionClip(clip) || !clip.transition || !old.transition) return [clip];
    // Explicitly replacing the target pair is validated without guessing its intent.
    if (clip.transition.fromClipId !== old.transition.fromClipId || clip.transition.toClipId !== old.transition.toClipId) return [clip];
    let pair: ReturnType<typeof transitionPair>;
    try { pair = transitionPair(next.clips, clip.transition); }
    catch (error) {
      if (error instanceof TransitionBlendError) throw error;
      changed = true; return [];
    }
    const oldPair = transitionPair(before.clips, old.transition);
    if (clip.start !== old.start && clip.duration === old.duration && pair.cut === oldPair.cut) {
      const moved = findTransitionPlacement(next, clip.start + clip.duration / 2, { visualTrack: pair.track, duration:clip.duration, excludeId:clip.id });
      changed = true;
      return [{ ...clip, start:moved.start,duration:moved.duration, transition: { ...clip.transition, fromClipId: moved.from.id, toClipId: moved.to.id } }];
    }
    if (clip.start === old.start && clip.duration === old.duration && (pair.cut !== oldPair.cut || pair.from.start !== oldPair.from.start || pair.to.duration !== oldPair.to.duration)) {
      const start = Math.max(pair.from.start, clip.start + pair.cut - oldPair.cut);
      const end = Math.min(pair.to.start + pair.to.duration, clip.start + clip.duration + pair.cut - oldPair.cut);
      changed = true;
      if (pair.cut - start < 1 / next.fps - tolerance || end - pair.cut < 1 / next.fps - tolerance) return [];
      return [{ ...clip, start, duration: end - start }];
    }
    return [clip];
  });
  const result = changed ? { ...next, clips } : next;
  transitionSources(result.clips, result.fps);
  return result;
}
