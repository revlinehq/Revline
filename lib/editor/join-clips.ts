import { isTransitionClip, reconcileTransitionEdits } from './clip-transitions';
import { stackedMirrorCopyIds } from './mirror-blur-layout';
import { playbackRateOf, sourceEndOf } from './playback-rate';
import { deriveTrackCounts, layerGroup, normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

/** Source seconds a clip is ahead of the timeline: equal for a picture and the sound playing in sync with it. */
const syncOf = (clip: Clip) => clip.sourceStart - clip.start * playbackRateOf(clip);
const endOf = (clip: Clip) => clip.start + clip.duration;
const round = (value: number) => Math.round(value * 1000) / 1000;
const EPSILON = 1e-6;
const footage = (clip: Clip) => clip.kind === 'video' || clip.kind === 'image';

export type AudioAssetOf = (assetId: string) => string | undefined;

/** The sound that belongs to a video piece: its linked audio, or else the unlinked audio of the same source (the video's
 *  own asset or its extracted audio) that overlaps it most. In sync or not: this is how a misaligned piece is found. */
export function soundFor(timeline: Timeline, video: Clip, audioAssetOf: AudioAssetOf = () => undefined): Clip | undefined {
  if (video.kind !== 'video') return undefined;
  if (video.linkedClipId) {
    const pair = timeline.clips.find(clip => clip.id === video.linkedClipId);
    return pair?.kind === 'audio' && pair.linkedClipId === video.id ? pair : undefined;
  }
  if (!video.assetId) return undefined;
  const assets = new Set([video.assetId, audioAssetOf(video.assetId)].filter(Boolean));
  const overlap = (clip: Clip) => Math.min(endOf(clip), endOf(video)) - Math.max(clip.start, video.start);
  return timeline.clips.filter(clip => clip.kind === 'audio' && !clip.linkedClipId && clip.assetId && assets.has(clip.assetId) && !clip.speedRamp?.length
    && Math.abs(playbackRateOf(clip) - playbackRateOf(video)) < EPSILON && overlap(clip) > EPSILON)
    .sort((a, b) => overlap(b) - overlap(a))[0];
}

export type SoundMisalignment = { videoClipId: string; audioClipId: string; outOfSyncSeconds: number; video: { start: number; end: number }; audio: { start: number; end: number }; problem: string };

/** Footage pieces whose sound plays out of sync with the picture, or whose sound starts or ends elsewhere than the
 *  picture without a J/L split edit. Half a frame is tolerated. */
export function soundMisalignments(input: Timeline, audioAssetOf: AudioAssetOf = () => undefined): SoundMisalignment[] {
  const timeline = normalizeTimeline(input), half = .5 / timeline.fps, copies = stackedMirrorCopyIds(timeline), found: SoundMisalignment[] = [];
  for (const video of timeline.clips) {
    if (video.kind !== 'video' || copies.has(video.id) || video.speedRamp?.length) continue;
    const sound = soundFor(timeline, video, audioAssetOf);
    if (!sound) continue;
    // Two pieces of the same take share one sound clip only when the sound was never split with the picture.
    const sharers = timeline.clips.filter(other => other.kind === 'video' && other.id !== video.id && soundFor(timeline, other, audioAssetOf)?.id === sound.id);
    const drift = (syncOf(sound) - syncOf(video)) / playbackRateOf(video);
    const edges = Math.abs(sound.start - video.start) > half || Math.abs(endOf(sound) - endOf(video)) > half;
    const problem = Math.abs(drift) > half ? `sound is ${round(Math.abs(drift))} s ${drift > 0 ? 'ahead of' : 'behind'} the picture` : edges && !video.audioSeparated && !sharers.length ? 'sound starts or ends elsewhere than the picture' : '';
    if (problem) found.push({ videoClipId: video.id, audioClipId: sound.id, outOfSyncSeconds: round(drift), video: { start: round(video.start), end: round(endOf(video)) }, audio: { start: round(sound.start), end: round(endOf(sound)) }, problem });
  }
  return found;
}

/** Put each footage piece's own unlinked sound back in sync with its picture and on the same in/out: the sound a user
 *  split and nudged apart. Only a sound that belongs to one picture, without a J/L split edit (audioSeparated), moves;
 *  linked pairs are kept equal by every edit already. Returns the sound clips it moved. */
export function alignSounds(input: Timeline, audioAssetOf: AudioAssetOf = () => undefined, onlyVideoIds?: ReadonlySet<string>): { timeline: Timeline; aligned: string[] } {
  const timeline = normalizeTimeline(input), patches = new Map<string, Partial<Clip>>();
  for (const item of soundMisalignments(timeline, audioAssetOf)) {
    const video = timeline.clips.find(clip => clip.id === item.videoClipId)!, sound = timeline.clips.find(clip => clip.id === item.audioClipId)!;
    if (sound.linkedClipId || video.audioSeparated || (onlyVideoIds && !onlyVideoIds.has(video.id)) || patches.has(sound.id)) continue;
    if (timeline.clips.some(other => other.id !== video.id && other.kind === 'video' && soundFor(timeline, other, audioAssetOf)?.id === sound.id)) continue;
    patches.set(sound.id, { start: video.start, duration: video.duration, sourceStart: video.sourceStart });
  }
  if (!patches.size) return { timeline: input, aligned: [] };
  return { timeline: { ...timeline, clips: timeline.clips.map(clip => patches.has(clip.id) ? { ...clip, ...patches.get(clip.id) } : clip) }, aligned: [...patches.keys()] };
}

export type JoinGap = 'keep-cut' | 'restore';
export type JoinResult = { timeline: Timeline; clipId: string; pieces: { clipId: string; sourceStart: number; sourceEnd: number; start: number; end: number }[]; joined: string[]; restoredSeconds: number; rippledBy: number; movedCaptions: number; alignedSound: string[] };

/** The two footage clips either side of the cut (or gap) at a timeline second, on `track` or the main footage layer. */
export function clipsAtCut(input: Timeline, at: number, track?: number): [string, string] {
  const timeline = normalizeTimeline(input), copies = stackedMirrorCopyIds(timeline), tolerance = Math.max(.1, 2 / timeline.fps);
  const totals = new Map<number, number>();
  for (const clip of timeline.clips) if (footage(clip) && !copies.has(clip.id)) totals.set(trackOf(clip), (totals.get(trackOf(clip)) ?? 0) + clip.duration);
  const layer = track ?? [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const row = timeline.clips.filter(clip => footage(clip) && !copies.has(clip.id) && trackOf(clip) === layer).sort((a, b) => a.start - b.start);
  const index = row.findIndex((clip, at_) => at_ > 0 && at >= endOf(row[at_ - 1]) - tolerance && at <= clip.start + tolerance);
  if (index < 1) throw new Error(`No cut or gap between two clips at ${round(at)} s on V${layer ?? 1}. Read the cuts with inspectTimeline, or pass clipIds.`);
  return [row[index - 1].id, row[index].id];
}

/**
 * Join adjacent pieces of one source on one layer into one clip, in one change: the way to undo a split or rejoin pieces
 * the user split and spaced apart. Gaps between them close. Source that runs on from one piece to the next becomes one
 * seamless clip; source removed between them stays removed with `keep-cut` (the pieces butt together as a cut) or comes
 * back with `restore` (one clip through the removed footage). The first piece's properties win. Each piece's sound (linked,
 * or the unlinked audio of the same source under it) is joined the same way and lands in sync with the picture. Later
 * clips on the layer, their sound and the captions over moved footage ripple by the same time.
 */
export function joinClips(input: Timeline, ids: readonly string[], gap: JoinGap = 'keep-cut', audioAssetOf: AudioAssetOf = () => undefined, newId: () => string = () => crypto.randomUUID()): JoinResult {
  const timeline = normalizeTimeline(input);
  if (new Set(ids).size < 2) throw new Error('Choose two or more clips to join.');
  const byId = new Map(timeline.clips.map(clip => [clip.id, clip]));
  // A sound clip names its picture.
  const pieces = [...new Set(ids.map(id => {
    const clip = byId.get(id);
    if (!clip) throw new Error(`Clip ${id} is not on this timeline. Read the current ids with inspectTimeline.`);
    const video = clip.kind === 'audio' && clip.linkedClipId ? byId.get(clip.linkedClipId) : clip;
    return (video ?? clip).id;
  }))].map(id => byId.get(id)!).sort((a, b) => a.start - b.start);
  if (pieces.length < 2) throw new Error('These ids name one clip (a picture and its own sound). Choose two or more pieces to join.');
  const first = pieces[0];
  if (first.kind !== 'video' && first.kind !== 'audio') throw new Error(`Clip ${first.id} is ${first.kind === 'image' ? 'an image' : `a ${first.kind} clip`}: only video or audio pieces of one source join.`);
  for (const piece of pieces.slice(1)) {
    if (piece.kind !== first.kind || piece.assetId !== first.assetId) throw new Error(`Clip ${piece.id} is not from the same source as ${first.id} (${piece.kind === first.kind ? `media ${piece.assetId ?? 'none'} vs ${first.assetId ?? 'none'}` : `${piece.kind} vs ${first.kind}`}): only pieces of one source join.`);
    if (trackOf(piece) !== trackOf(first)) throw new Error(`Clip ${piece.id} is on ${first.kind === 'audio' ? 'A' : 'V'}${trackOf(piece)}, not ${first.kind === 'audio' ? 'A' : 'V'}${trackOf(first)} with ${first.id}: only pieces on one layer join.`);
    if (Math.abs(playbackRateOf(piece) - playbackRateOf(first)) > EPSILON || !!piece.speedRamp?.length || !!first.speedRamp?.length) throw new Error(`Clip ${piece.id} plays at a different speed than ${first.id} (or has a speed ramp): reset the speed before joining.`);
  }
  // Adjacent: nothing else on the layer between consecutive pieces.
  const group = layerGroup(first.kind), pieceIds = new Set(pieces.map(piece => piece.id));
  for (let index = 1; index < pieces.length; index++) {
    const a = pieces[index - 1], b = pieces[index];
    const between = timeline.clips.find(clip => !pieceIds.has(clip.id) && !isTransitionClip(clip) && layerGroup(clip.kind) === group && trackOf(clip) === trackOf(first) && clip.start < b.start - EPSILON && endOf(clip) > endOf(a) + EPSILON);
    if (between) throw new Error(`Clips ${a.id} and ${b.id} are not adjacent: ${between.id} (${round(between.start)}–${round(endOf(between))} s) sits between them on ${first.kind === 'audio' ? 'A' : 'V'}${trackOf(first)}. Join only neighbouring pieces.`);
  }
  const sounds = pieces.map(piece => piece.kind === 'video' ? soundFor(timeline, piece, audioAssetOf) : undefined);
  const rate = playbackRateOf(first), slack = .5 / timeline.fps * rate;
  // One run of source per output clip, laid out from the first piece's start.
  type Run = { sourceStart: number; sourceEnd: number; template: Clip; sound?: Clip; from: Clip[] };
  const runs: Run[] = [];
  let restored = 0;
  pieces.forEach((piece, index) => {
    const last = runs.at(-1), sourceStart = piece.sourceStart, sourceEnd = sourceEndOf(piece);
    if (last && Math.abs(sourceStart - last.sourceEnd) <= slack) { last.sourceEnd = sourceEnd; last.from.push(piece); return; }
    if (last && gap === 'restore') {
      if (sourceStart < last.sourceEnd) throw new Error(`Clip ${piece.id} starts in its source (${round(sourceStart)} s) before ${last.from.at(-1)!.id} ends (${round(last.sourceEnd)} s), so no removed footage lies between them to restore. Join them with gap 'keep-cut'.`);
      restored += (sourceStart - last.sourceEnd) / rate; last.sourceEnd = sourceEnd; last.from.push(piece); return;
    }
    runs.push({ sourceStart, sourceEnd, template: piece, sound: sounds[index], from: [piece] });
  });
  // A run without its own sound borrows the take's sound as a template, so the joined picture is never left silent.
  const anySound = sounds.find(Boolean);
  for (const run of runs) run.sound ??= anySound;
  const kept = new Set(runs.map(run => run.template.id)), dropped = new Set<string>([...pieces.map(piece => piece.id), ...sounds.flatMap(sound => sound ? [sound.id] : [])]);
  const transition = timeline.clips.find(clip => isTransitionClip(clip) && clip.transition && [clip.transition.fromClipId, clip.transition.toClipId].some(id => dropped.has(id) && !kept.has(id)));
  if (transition) throw new Error(`A transition (${transition.id}) is connected to a piece this join replaces. Remove it before joining.`);
  const used = new Set(timeline.clips.filter(clip => !dropped.has(clip.id)).map(clip => clip.id));
  const freshId = () => { let id = newId(); while (!id || used.has(id)) id = newId(); used.add(id); return id; };
  const oldPictureEnd = endOf(pieces.at(-1)!), added: Clip[] = [], placed: JoinResult['pieces'] = [], pieceShift = new Map<string, number>();
  let cursor = first.start;
  runs.forEach((run, index) => {
    const duration = (run.sourceEnd - run.sourceStart) / rate;
    // The first piece's properties win; a later run kept at a cut keeps its own.
    const base = index === 0 ? first : run.template;
    used.add(base.id);
    const clip: Clip = { ...base, start: cursor, duration, sourceStart: run.sourceStart };
    delete clip.linkedClipId;
    for (const piece of run.from) pieceShift.set(piece.id, cursor + (piece.sourceStart - run.sourceStart) / rate - piece.start);
    const template = run.sound;
    if (template) {
      const linked = !!template.linkedClipId, soundId = used.has(template.id) ? freshId() : (used.add(template.id), template.id);
      // In sync with the picture: same timeline span, the source shifted by the take's own offset (0 for its extracted audio).
      const offset = linked ? template.sourceStart - (timeline.clips.find(item => item.id === template.linkedClipId)?.sourceStart ?? template.sourceStart) : 0;
      const sound: Clip = { ...template, id: soundId, start: cursor, duration, sourceStart: run.sourceStart + offset };
      delete sound.linkedClipId;
      if (linked) { sound.linkedClipId = clip.id; clip.linkedClipId = soundId; }
      added.push(clip, sound);
    } else added.push(clip);
    placed.push({ clipId: clip.id, sourceStart: round(run.sourceStart), sourceEnd: round(run.sourceEnd), start: round(cursor), end: round(cursor + duration) });
    cursor += duration;
  });
  const drop = dropped, shiftOf = new Map<string, number>();
  const rippledBy = cursor - oldPictureEnd;
  // Later clips on the layer and their sound (linked, or the unlinked audio of the same source under them) move by the same time.
  const copies = stackedMirrorCopyIds(timeline);
  for (const clip of timeline.clips) {
    if (drop.has(clip.id) || isTransitionClip(clip) || layerGroup(clip.kind) !== group || trackOf(clip) !== trackOf(first) || clip.start < oldPictureEnd - EPSILON) continue;
    shiftOf.set(clip.id, rippledBy);
    const sound = clip.kind === 'video' ? soundFor(timeline, clip, audioAssetOf) : undefined;
    if (sound && !drop.has(sound.id)) shiftOf.set(sound.id, rippledBy);
    for (const copy of copies) { const mirror = byId.get(copy); if (mirror && Math.abs(mirror.start - clip.start) < EPSILON && trackOf(mirror) !== trackOf(clip)) shiftOf.set(copy, rippledBy); }
  }
  // Captions over moved footage move with it; captions after the join ripple with the later clips.
  let movedCaptions = 0;
  for (const caption of timeline.clips) {
    if (caption.kind !== 'caption') continue;
    // A caption in a gap between pieces goes with the piece after it.
    const over = pieces.find((piece, index) => caption.start >= (index ? endOf(pieces[index - 1]) : piece.start) - EPSILON && caption.start < endOf(piece) - EPSILON);
    const delta = over ? pieceShift.get(over.id)! : caption.start >= oldPictureEnd - EPSILON ? rippledBy : undefined;
    if (delta !== undefined && Math.abs(delta) > EPSILON) { shiftOf.set(caption.id, delta); movedCaptions++; }
  }
  // The replaced pieces leave; the joined clips and their sound take the first piece's place in clip order.
  const at = timeline.clips.findIndex(clip => clip.id === first.id);
  const clips = timeline.clips.flatMap((clip, index) => {
    if (index === at) return added;
    if (drop.has(clip.id)) return [];
    const delta = shiftOf.get(clip.id);
    return delta === undefined ? [clip] : [{ ...clip, start: Math.max(0, clip.start + delta) }];
  });
  const next = reconcileTransitionEdits(timeline, { ...timeline, clips });
  return { timeline: { ...next, tracks: deriveTrackCounts(next) }, clipId: first.id, pieces: placed, joined: pieces.filter(piece => !placed.some(item => item.clipId === piece.id)).map(piece => piece.id), restoredSeconds: round(restored), rippledBy: round(rippledBy), movedCaptions, alignedSound: sounds.flatMap(sound => sound ? [sound.id] : []) };
}
