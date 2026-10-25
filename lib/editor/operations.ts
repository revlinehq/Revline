import { DEFAULT_SOLID_COLOR, EFFECT_CATALOG, isSolidColorClip, motionPreset, offsetClipMotion, resizeEffectMotion,validateClipEffects, type BlendMode,type EffectPreset } from './clip-effects';
import { TimelineGestureRejection } from './timeline-edit-errors';
import { textTemplateTimingPatch } from './remotion-text';
import { textAnimationTimingPatch } from './text-animation-timing';
import { audioFadeTimingPatch } from './audio-settings';
import { visualFadeTimingPatch } from './visual-fades';
import { rescaleSmoothZoom } from './smooth-zoom-settings';
import { rescaleCameraMotion } from './camera-motion-settings';
import { playbackRateOf, sourceDurationOf, sourceEndOf, validatePlaybackRate } from './playback-rate';
import { boundedTransitionRange, DEFAULT_TRANSITION_DIRECTION, findTransitionPlacement, isTransitionClip, isTransitionPreset, reconcileTransitionEdits, transitionPair, transitionSources, type ClipTransition, type TransitionDirection, type TransitionPreset } from './clip-transitions';
import { Clip, Timeline, timelineDuration, layerGroup, trackOf, deriveTrackCounts, normalizeTimeline, maxTrackCount } from './types';
export function snapTime(time: number, fps: number) { return Math.round(Math.max(0, time) * fps) / fps; }
export function linkedClipIds(timeline: Timeline, ids: string[]): string[] {
  const selected = new Set(ids);
  for (const clip of timeline.clips) if (selected.has(clip.id) && clip.linkedClipId) selected.add(clip.linkedClipId);
  return [...selected];
}
export function unlinkClips(timeline: Timeline, id: string): Timeline {
  const ids = new Set(linkedClipIds(timeline, [id]));
  return { ...timeline, clips: timeline.clips.map(clip => ids.has(clip.id) ? { ...clip, linkedClipId: undefined } : clip) };
}
/** Apply a shared blend atomically so both sides of a transition can stay compatible. */
export function setClipBlendMode(timeline:Timeline,ids:string[],blendMode:BlendMode):Timeline{
  const selected=new Set(ids);
  if(!selected.size||ids.some(id=>!timeline.clips.some(clip=>clip.id===id)))throw new Error('Choose existing visual clip IDs.');
  const next={...timeline,clips:timeline.clips.map(clip=>{
    if(!selected.has(clip.id))return clip;
    if(clip.kind==='audio'||clip.kind==='effect')throw new Error('Blend modes apply to footage or text clips.');
    const changed={...clip,blendMode};validateClipEffects(changed);return changed;
  })};
  return reconcileTransitionEdits(timeline,next);
}
/** Seek to a frame without clamping back to an imported, fractional endpoint. */
export function frameSeekTime(time: number, fps: number, duration: number) {
  if (![time, fps, duration].every(Number.isFinite) || fps <= 0 || duration <= 0) return 0;
  // Match the composition clock's seven-decimal precision at exact frame ends.
  const lastFrame = Math.floor((duration + 1e-7) * fps);
  if (!Number.isFinite(lastFrame)) return 0;
  const frame = Math.min(lastFrame, Math.round(Math.max(0, Math.min(time, duration)) * fps));
  return frame / fps;
}
export function splitClip(timeline: Timeline, clipId: string, time: number, newId: string): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === clipId);
  if (clip && isTransitionClip(clip)) throw new TimelineGestureRejection('Transitions connect two clips and cannot be split.');
  const reject = () => { throw new TimelineGestureRejection('Place the playhead inside the selected clip to split it.'); };
  if (!clip || ![time, timeline.fps, clip.start, clip.duration, clip.sourceStart, clip.start + clip.duration].every(Number.isFinite)
    || timeline.fps <= 0 || clip.start < 0 || clip.sourceStart < 0 || time <= clip.start || time >= clip.start + clip.duration) return reject();
  const frame = 1 / timeline.fps;
  let offset = snapTime(time - clip.start, timeline.fps);
  let tail = clip.duration - offset;
  // Absorb subtraction round-off at one frame, while rejecting genuinely shorter fragments.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(clip.duration), Math.abs(offset)) * 8;
  if (offset < frame - roundoff || tail < frame - roundoff) return reject();
  if (Math.abs(tail - frame) <= roundoff) { tail = frame; offset = clip.duration - tail; }
  if (Math.abs(offset - frame) <= roundoff) offset = frame;
  const pair = timeline.clips.find(c => c.id === clip.linkedClipId && c.linkedClipId === clip.id);
  const pairId = `${newId}-audio`;
  const next = { ...timeline, clips: timeline.clips.flatMap(c => c.id !== clipId && c.id !== pair?.id ? [c] : [
    { ...c, ...textTemplateTimingPatch(c),...textAnimationTimingPatch(c),...audioFadeTimingPatch(c),...visualFadeTimingPatch(c), duration: offset },
    { ...c, ...offsetClipMotion(c, offset), id: c.id === clipId ? newId : pairId, linkedClipId: pair ? c.id === clipId ? pairId : newId : undefined, start: c.start + offset, sourceStart: c.kind === 'effect' || c.kind === 'solid' ? 0 : c.sourceStart + offset * playbackRateOf(c), duration: tail },
  ]) };
  // Only the outgoing piece touching the original cut inherits that transition.
  next.clips = next.clips.flatMap(c => {
    if (!c.transition || (c.transition.fromClipId !== clipId && c.transition.fromClipId !== pair?.id)) return [c];
    const fromClipId=c.transition.fromClipId===clipId?newId:pairId;
    const transition = { ...c.transition, fromClipId }, from = next.clips.find(member => member.id === fromClipId)!;
    const start = Math.max(c.start, from.start), end = c.start + c.duration;
    if (from.start + from.duration - start < frame - 1e-6) return [];
    return [{ ...c, transition, start, duration: end - start }];
  });
  return reconcileTransitionEdits(timeline, next);
}
export function patchClip(timeline: Timeline, id: string, patch: Partial<Clip>): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === id);
  if (!clip) return timeline;
  if (isTransitionClip(clip) && patch.duration !== undefined && patch.start === undefined) {
    const pair = transitionPair(timeline.clips, clip.transition!);
    patch = { ...patch, ...boundedTransitionRange(timeline, pair.from, pair.to, patch.duration,clip.id) };
  }
  const timing: Partial<Clip> = {};
  for (const key of ['start', 'duration', 'sourceStart', 'playbackRate'] as const) if (patch[key] !== undefined || (key === 'playbackRate' && key in patch)) timing[key] = patch[key];
  const volumeTarget = clip.kind === 'video' && clip.linkedClipId ? clip.linkedClipId : id;
  return reconcileTransitionEdits(timeline, { ...timeline, clips: timeline.clips.map(c => {
    let next = c.id === id ? { ...c, ...(patch.duration !== undefined && !('textTemplate' in patch) ? textTemplateTimingPatch(c) : {}),...(patch.duration!==undefined&&!('textAnimationTiming' in patch)?textAnimationTimingPatch(c):{}),...(patch.duration!==undefined&&!('audioFadeTiming' in patch)?audioFadeTimingPatch(c):{}),...(patch.duration!==undefined&&!('visualFadeTiming' in patch)?visualFadeTimingPatch(c):{}), ...patch, id: c.id } : c.id === clip.linkedClipId ? { ...c, ...timing,...(patch.duration!==undefined?audioFadeTimingPatch(c):{}) } : c;
    if(c.id===id&&['motion','crop','fit','focus','assetId'].some(key=>key in patch)&&!('smoothZoom' in patch))next={...next,smoothZoom:undefined};
    if(c.id===id&&['motion','crop','fit','focus','assetId'].some(key=>key in patch)&&!('cameraMotion' in patch))next={...next,cameraMotion:undefined};
    if(c.id===id&&['caption','graphic'].includes(c.kind)&&patch.color!==undefined&&!('textGradient' in patch))next={...next,textGradient:undefined};
    if(c.id===id&&patch.text!==undefined&&c.textTemplate?.wordTimings&&!('textTemplate' in patch)&&patch.text.toLowerCase()!==(c.text??'').toLowerCase())next={...next,textTemplate:{...next.textTemplate!,wordTimings:undefined}};
    if (patch.volume !== undefined && c.id === volumeTarget) next = { ...next, volume: patch.volume };
    if (next.kind === 'video' && next.audioSeparated) next = { ...next, volume: 0 };
    return next;
  }) });
}
/** Keep the retained source range and linked sound while changing playback speed. */
export function setClipPlaybackRate(timeline: Timeline, id: string, playbackRate: number): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === id);
  if (!clip) throw new Error('Choose a video or audio clip to change its speed.');
  validatePlaybackRate({ kind: clip.kind, playbackRate });
  if (playbackRateOf(clip) === playbackRate) return timeline;
  const duration = sourceDurationOf(clip) / playbackRate;
  if (!Number.isFinite(duration) || duration < 1 / timeline.fps) throw new Error('This speed would make the clip shorter than one frame.');
  const ids = new Set(linkedClipIds(timeline, [id]));
  if (duration > clip.duration && timeline.clips.some(member => ids.has(member.id) && timeline.clips.some(other => !ids.has(other.id)
    && layerGroup(member.kind) === layerGroup(other.kind) && trackOf(member) === trackOf(other)
    && other.start < member.start + duration - 1e-6 && member.start < other.start + other.duration - 1e-6))) {
    throw new Error('The slower clip would overlap another clip. Move it or make room before changing speed.');
  }
  const ratio = duration / clip.duration;
  const next = patchClip(timeline, id, { playbackRate, duration });
  return { ...next, clips: next.clips.map(member => {
    if(!ids.has(member.id))return member;
    let changed=member.motion?.length?{...member,motion:member.motion.map(key=>({...key,time:key.time*ratio})),motionOffset:(member.motionOffset??0)*ratio}:member;
    if(member.smoothZoom)changed={...changed,smoothZoom:rescaleSmoothZoom(member.smoothZoom,ratio)};
    if(member.cameraMotion)changed={...changed,cameraMotion:rescaleCameraMotion(member.cameraMotion,ratio)};
    if(member.kind==='audio'&&member.audioFadeTiming)changed={...changed,audio:member.audio?{...member.audio,fadeIn:member.audio.fadeIn*ratio,fadeOut:member.audio.fadeOut*ratio}:undefined,audioFadeTiming:{duration:member.audioFadeTiming.duration*ratio,offset:member.audioFadeTiming.offset*ratio}};
    if((member.kind==='video'||member.kind==='image')&&member.visualFadeTiming)changed={...changed,visualFade:member.visualFade?{fadeIn:member.visualFade.fadeIn*ratio,fadeOut:member.visualFade.fadeOut*ratio}:undefined,visualFadeTiming:{duration:member.visualFadeTiming.duration*ratio,offset:member.visualFadeTiming.offset*ratio}};
    return changed;
  }) };
}
export function deleteClip(timeline: Timeline, id: string): Timeline { timeline = normalizeTimeline(timeline); const ids = new Set(linkedClipIds(timeline, [id])); return reconcileTransitionEdits(timeline, { ...timeline, clips: timeline.clips.filter(c => !ids.has(c.id)) }); }
export function addMediaClip(timeline: Timeline, asset: { _id: string; kind: Clip['kind']; duration?: number; audioAssetId?: string; preparation?: {message:string} }, id: string, at?: number, track = 1): Timeline {
  if(asset.preparation)throw new Error(asset.preparation.message);
  timeline = normalizeTimeline(timeline);
  const group = layerGroup(asset.kind);
  const trackEnd = Math.max(0, ...timeline.clips.filter(c => layerGroup(c.kind) === group && trackOf(c) === track).map(c => c.start + c.duration));
  const start = at ?? trackEnd;
  if (!Number.isFinite(start) || start < 0) throw new Error('Choose a valid timeline position.');
  const duration = asset.kind === 'image' ? 5 : asset.duration ?? 5;
  if (!Number.isFinite(duration) || duration < 1 / timeline.fps) throw new Error('This source is shorter than one frame. Choose another source.');
  const next = placeOnFreeLayer(timeline, { id, kind: asset.kind, assetId: asset._id, track, start, duration, sourceStart: 0, volume: 1, ...((asset.kind === 'video' || asset.kind === 'image') ? { fit: 'contain' as const } : {}) });
  return separateVideoClips(next, asset);
}
/** Preserve existing cuts and levels when giving a video's sound its own clip. */
export function separateVideoClips(timeline: Timeline, asset: { _id: string; audioAssetId?: string }): Timeline {
  if (!asset.audioAssetId) return timeline;
  let next = timeline;
  for (const clip of timeline.clips) {
    if (clip.kind !== 'video' || clip.assetId !== asset._id || clip.audioSeparated) continue;
    const audioId = `${clip.id}-audio`;
    next = placeOnFreeLayer(next, { id: audioId, kind: 'audio', assetId: asset.audioAssetId, track: 1, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, playbackRate: clip.playbackRate, volume: clip.volume ?? 1, linkedClipId: clip.id });
    next = { ...next, clips: next.clips.map(c => c.id === clip.id ? { ...c, volume: 0, audioSeparated: true, linkedClipId: audioId } : c) };
  }
  return next;
}
export function addTextClip(timeline: Timeline, id: string, kind: 'caption' | 'graphic', at: number): Timeline {
  timeline = normalizeTimeline(timeline);
  return placeOnFreeLayer(timeline, { id, kind, start: at, duration: Math.min(3, Math.max(1, timelineDuration(timeline) - at)), sourceStart: 0, text: kind === 'caption' ? 'Your words here.' : 'MAKE ROOM FOR YOUR NEXT IDEA.', fontSize: kind === 'caption' ? 52 : 92, color: '#F4F4F0', background: kind === 'caption' ? '#0B0C0E' : 'transparent', x: 0.5, y: kind === 'caption' ? 0.82 : 0.55, animation: 'none' });
}
/** An FX clip affects the visual composition only during its own range. */
export function addEffectClip(timeline: Timeline, id: string, preset: EffectPreset, at: number, options: { duration?: number; aboveClipId?: string; track?: number; direction?: TransitionDirection; visualTrack?: number } = {}): Timeline {
  timeline = normalizeTimeline(timeline);
  if (!Number.isFinite(at) || at < 0) throw new Error('Choose a valid effect position.');
  if (isTransitionPreset(preset)) {
    const pair = findTransitionPlacement(timeline, at, { aboveClipId: options.aboveClipId, duration:options.duration, visualTrack:options.visualTrack });
    return addTransitionClip(timeline, id, preset, pair.from.id, pair.to.id, options);
  }
  const requestedDuration = options.duration ?? EFFECT_CATALOG[preset].duration;
  if (!Number.isFinite(requestedDuration) || requestedDuration < 1 / timeline.fps) throw new Error('An effect must last at least one frame.');
  const start = snapTime(at, timeline.fps), duration = Math.max(1 / timeline.fps, snapTime(requestedDuration, timeline.fps));
  const target = options.aboveClipId ? timeline.clips.find(clip => clip.id === options.aboveClipId) : undefined;
  if (options.aboveClipId && (!target || target.kind === 'audio')) throw new Error('Choose a visual clip beneath the effect.');
  if (preset === 'solid-color') {
    const track = options.track ?? (target && layerGroup(target.kind) === 'visual' ? trackOf(target) + 1 : 1);
    return placeOnFreeLayer(timeline, { id, kind:'solid', track, start, duration, sourceStart:0, solidColor:{...DEFAULT_SOLID_COLOR} });
  }
  const track = options.track ?? (target?.kind === 'effect' ? trackOf(target) + 1 : 1);
  if (!Number.isInteger(track) || track < 1 || track > maxTrackCount('effects')) throw new Error('Choose an FX track between 1 and 24.');
  const clip: Clip = { id, kind: 'effect', track, start, duration, sourceStart: 0 };
  return placeOnFreeLayer(timeline, { ...clip, ...motionPreset(clip, preset) });
}
/** Explicit conversion preserves a saved FX rectangle's timing, settings and motion. */
export function convertSolidColorToVisual(timeline:Timeline,id:string):Timeline {
  const clip=timeline.clips.find(clip=>clip.id===id);
  if(!clip||!isSolidColorClip(clip))throw new Error('Choose a solid color clip.');
  if(clip.kind==='solid')return timeline;
  const {effectPreset:_preset,...retained}=clip;
  return placeOnFreeLayer(timeline,{...retained,kind:'solid',track:undefined});
}
/** Visual-only transition: the joined footage and linked audio keep every timing field. */
export function addTransitionClip(timeline: Timeline, id: string, preset: TransitionPreset, fromClipId: string, toClipId: string, options: Partial<Omit<ClipTransition, 'fromClipId' | 'toClipId'>> & { duration?: number; track?: number } = {}): Timeline {
  timeline = normalizeTimeline(timeline);
  const pair = transitionPair(timeline.clips, { fromClipId, toClipId });
  const settings = Object.fromEntries((['wipeDirection','softness','centerX','centerY','shape'] as const).filter(key => options[key] !== undefined).map(key => [key,options[key]]));
  const clip: Clip = { id, kind: 'effect', sourceStart: 0, track: options.track ?? 1, effectPreset: preset,
    ...boundedTransitionRange(timeline, pair.from, pair.to, options.duration,id),
    transition: { ...settings, fromClipId, toClipId, direction: options.direction ?? DEFAULT_TRANSITION_DIRECTION },
  };
  const next = placeOnFreeLayer(timeline, clip);
  transitionSources(next.clips, next.fps);
  return next;
}
/** The first layer at or above `track` where `clip` meets no other clip of its group. */
export function freeLayer(clips: Clip[], clip: Clip, track: number, ignore: ReadonlySet<string>) {
  const group = layerGroup(clip.kind);
  const overlaps = (other: Clip) => !ignore.has(other.id) && layerGroup(other.kind) === group && trackOf(other) === track && other.start < clip.start + clip.duration - 0.000001 && clip.start < other.start + other.duration - 0.000001;
  const maximum = maxTrackCount(group);
  while (track <= maximum && clips.some(overlaps)) track++;
  if (track > maximum) throw new Error(`All ${maximum} layers overlap here. Move the clip to another time or remove a layer.`);
  return track;
}
/** Keep overlapping clips separate; an existing ID moves rather than duplicates. */
export function placeOnFreeLayer(timeline: Timeline, clip: Clip): Timeline {
  timeline = normalizeTimeline(timeline);
  const previous = timeline.clips.find(current => current.id === clip.id);
  if (previous?.linkedClipId) timeline = patchClip(timeline, clip.id, { start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, playbackRate: clip.playbackRate });
  if (clip.kind === 'video' && clip.audioSeparated) clip = { ...clip, volume: 0 };
  let track = trackOf(clip);
  if (clip.track === undefined && (clip.kind === 'caption' || clip.kind === 'graphic' || clip.kind === 'scene')) {
    const beneath = timeline.clips.filter(other => other.id !== clip.id && layerGroup(other.kind) === 'visual'
      && other.start < clip.start + clip.duration - 0.000001 && clip.start < other.start + other.duration - 0.000001);
    track = Math.max(0, ...beneath.map(trackOf)) + 1;
  }
  const placed = { ...clip, track: freeLayer(timeline.clips, clip, track, new Set([clip.id])) };
  let clips = timeline.clips.some(current => current.id === clip.id) ? timeline.clips.map(current => current.id === clip.id ? placed : current) : [...timeline.clips, placed];
  // The re-synced partner follows the new timing, so it needs its own free layer too.
  const partner = previous?.linkedClipId ? clips.find(current => current.id === previous.linkedClipId) : undefined;
  if (partner) {
    const partnerTrack = freeLayer(clips, partner, trackOf(partner), new Set([partner.id, clip.id]));
    if (partnerTrack !== trackOf(partner)) clips = clips.map(current => current.id === partner.id ? { ...partner, track: partnerTrack } : current);
  }
  const next = { ...timeline, clips };
  return reconcileTransitionEdits(timeline, { ...next, tracks: deriveTrackCounts(next) });
}
/** Same-layer clip pairs overlapping by more than `tolerance` seconds; touching edges never overlap. */
export function layerOverlaps(timeline: Timeline, tolerance = 0.000001): [Clip, Clip][] {
  const layers = new Map<string, Clip[]>();
  for (const clip of timeline.clips) {
    const key = `${layerGroup(clip.kind)}:${trackOf(clip)}`;
    const layer = layers.get(key);
    if (layer) layer.push(clip); else layers.set(key, [clip]);
  }
  const pairs: [Clip, Clip][] = [];
  for (const clips of layers.values()) {
    clips.sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length && clips[j].start < clips[i].start + clips[i].duration - tolerance; j++) pairs.push([clips[i], clips[j]]);
  }
  return pairs;
}
/** Overlaps an edit introduces. Collisions already saved stay editable: the same pair
 * may keep overlapping (even after a layer reorder), and split or re-identified pieces
 * may stay inside a span that already overlapped on that layer. */
export function newLayerOverlaps(before: Timeline, after: Timeline, tolerance = 0.000001): [Clip, Clip][] {
  before = normalizeTimeline(before); after = normalizeTimeline(after);
  const key = ([a, b]: [Clip, Clip]) => a.id < b.id ? `${a.id}\n${b.id}` : `${b.id}\n${a.id}`;
  const layer = (clip: Clip) => `${layerGroup(clip.kind)}:${trackOf(clip)}`;
  const span = ([a, b]: [Clip, Clip]) => [Math.max(a.start, b.start), Math.min(a.start + a.duration, b.start + b.duration)] as const;
  const existing = new Set<string>(), spans = new Map<string, (readonly [number, number])[]>();
  for (const pair of layerOverlaps(before, tolerance)) {
    existing.add(key(pair));
    spans.set(layer(pair[0]), [...(spans.get(layer(pair[0])) ?? []), span(pair)]);
  }
  const covered = (pair: [Clip, Clip]) => {
    const [start, end] = span(pair);
    return (spans.get(layer(pair[0])) ?? []).some(([from, to]) => start >= from - tolerance && end <= to + tolerance);
  };
  return layerOverlaps(after, tolerance).filter(pair => !existing.has(key(pair)) && !covered(pair));
}
/** Change a clip's duration (and source in-point) without running into the next clip on its layer. */
export function trimClip(timeline: Timeline, id: string, duration: number, sourceStart?: number): Timeline {
  timeline = normalizeTimeline(timeline);
  const clip = timeline.clips.find(c => c.id === id);
  if (!clip) throw new Error('Choose a clip to trim.');
  const next = clip.kind === 'effect' ? patchClip(timeline, id, { ...resizeEffectMotion(clip, duration), duration }) : patchClip(timeline, id, { duration, sourceStart: sourceStart ?? clip.sourceStart });
  const collision = newLayerOverlaps(timeline, next)[0];
  if (collision) {
    // A pure refusal: the draft is unchanged, so the assistant can retry with the room available.
    const members = new Set(linkedClipIds(timeline, [id]));
    const own = collision.find(clip => members.has(clip.id)), other = collision.find(clip => clip !== own)!;
    if (!own) throw new TimelineGestureRejection(`Trimming this clip to ${duration}s would make clips ${collision[0].id} and ${collision[1].id} overlap on the same layer.`, 'overlap');
    const room = other.start - own.start;
    throw new TimelineGestureRejection(`Trimming this clip to ${duration}s would overlap clip ${other.id} on the same layer.${room >= 1 / timeline.fps ? ` At most ${Number(room.toFixed(3))}s fits;` : ''} move or trim the neighboring clip first.`, 'overlap');
  }
  return next;
}
/** Keep only source samples needed to interpolate this trimmed clip's crop. */
export function focusForClip(focus:NonNullable<Clip['focus']>,clip:Clip):NonNullable<Clip['focus']> {
  const start=clip.sourceStart;const end=sourceEndOf(clip);const before=focus.filter(s=>s.time<start).at(-1);const after=focus.find(s=>s.time>end);
  return [...(before?[before]:[]),...focus.filter(s=>s.time>=start&&s.time<=end),...(after?[after]:[])];
}
