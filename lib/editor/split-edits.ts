import { audioSettingsPatch } from './audio-settings';
import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { anchoredFadeTimingPatch } from './fade-clock';
import { stackedMirrorCopies, stackedMirrorCopyIds } from './mirror-blur-layout';
import { linkProblem, snapTime } from './operations';
import { playbackRateOf, sourceEndOf, sourceSpanOf, timelineTimeAtSource } from './playback-rate';
import { normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

export type SplitEditType = 'J' | 'L' | 'auto' | 'none';
export type SplitCut = { clipId?: string; at?: number; type?: SplitEditType; frames?: number };
export type SplitEditRequest = {
  /** The cuts to change. Omitted: every cut on the track, inside `range` when given. */
  cuts?: SplitCut[];
  range?: { start: number; end: number };
  track?: number;
  type?: SplitEditType;
  frames?: number;
  /** A short fade out and in at each sound edit, in frames. 0 removes it; omitted leaves fades alone. */
  fadeFrames?: number;
};
export type SpokenWord = { start: number; end: number; text: string };
export type SplitEditSources = {
  duration: (assetId: string) => number | undefined;
  audioAssetOf: (videoAssetId: string) => string | undefined;
  /** Spoken words of a video source, in its source seconds, with measured sound edges where available. */
  words: (assetId: string) => SpokenWord[] | undefined;
};
export type SplitEditOutcome = {
  /** Timeline second of the sound edit. */
  at: number;
  clipId: string;
  nextClipId: string;
  type: 'J' | 'L' | 'none';
  /** How far the picture edit sits from the sound edit. */
  frames: number;
  /** The last word before and the first word after the sound edit. */
  words?: string;
  /** Frames the sound edit moved to stop clipping a word (positive: later). */
  soundEditMoved?: number;
  note?: string;
};
export type SplitEditSkip = { at: number; clipId?: string; reason: string };
export type SplitEditResult = { timeline: Timeline; applied: SplitEditOutcome[]; skipped: SplitEditSkip[]; unchanged: number };

export const MAX_SPLIT_EDIT_SECONDS = 2;
/** A third of a second: 10 frames at 30 fps, 20 at 60 fps. */
export const defaultSplitEditFrames = (fps: number) => Math.round(fps / 3);
const EPSILON = 1e-3;
/** A cut this far inside a word's measured sound clips it; nearer than this is the word's own edge. */
const WORD_MARGIN = .06;
/** The picture edit takes at most this share of the neighbouring piece, so a piece cut on both sides keeps its middle. */
const MAX_SHARE = .4;
/** A shorter offset is not heard as a lead or a tail: 3 frames at 30 fps, 6 at 60 fps. */
export const MIN_SPLIT_EDIT_SECONDS = .1;
const MIN_PIECE_FRAMES = 2;
/** How far a cut named by time may be from the cut it means. */
const AT_TOLERANCE = .5;
const round = (value: number) => Math.round(value * 1000) / 1000;
const endOf = (clip: Clip) => clip.start + clip.duration;

type Join = { outgoing: Clip; incoming: Clip };

/** Video cuts on one layer: two video clips that touch. Mirror-blur copies are never cuts of their own. */
function joinsOn(timeline: Timeline, track: number): Join[] {
  const copies = stackedMirrorCopyIds(timeline);
  const row = timeline.clips.filter(clip => clip.kind === 'video' && trackOf(clip) === track && !copies.has(clip.id)).sort((a, b) => a.start - b.start);
  return row.flatMap((clip, index) => index > 0 && Math.abs(clip.start - endOf(row[index - 1])) < EPSILON ? [{ outgoing: row[index - 1], incoming: clip }] : []);
}
/** The layer a talking edit is cut on: the V layer with the most video time. */
function mainTrack(timeline: Timeline) {
  const copies = stackedMirrorCopyIds(timeline), totals = new Map<number, number>();
  for (const clip of timeline.clips) if (clip.kind === 'video' && !copies.has(clip.id)) totals.set(trackOf(clip), (totals.get(trackOf(clip)) ?? 0) + clip.duration);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
}
/** Source seconds the clip is ahead of the timeline: equal for a picture and the sound that plays in sync with it. */
const syncOf = (clip: Clip) => clip.sourceStart - clip.start * playbackRateOf(clip);

/**
 * The sound that belongs to a video clip: its linked audio, or after a J/L cut unlinked it, the audio
 * extracted from the same source that still plays in sync with it. Of several in-sync pieces of one
 * take, the one whose edges are nearest; the picture edit never moves further than MAX_SHARE of a piece.
 */
export function soundOf(timeline: Timeline, video: Clip, audioAssetOf: SplitEditSources['audioAssetOf']): Clip | undefined {
  if (video.linkedClipId) return timeline.clips.find(clip => clip.id === video.linkedClipId && clip.kind === 'audio' && clip.linkedClipId === video.id);
  const assetId = video.assetId ? audioAssetOf(video.assetId) : undefined;
  if (!assetId) return undefined;
  const rate = playbackRateOf(video);
  return timeline.clips.filter(clip => clip.kind === 'audio' && clip.assetId === assetId && !clip.linkedClipId && !clip.speedRamp?.length
    && Math.abs(playbackRateOf(clip) - rate) < 1e-6 && Math.abs(syncOf(clip) - syncOf(video)) < EPSILON * Math.max(1, rate)
    && clip.start < endOf(video) - EPSILON && video.start < endOf(clip) - EPSILON)
    .sort((a, b) => Math.abs(a.start - video.start) + Math.abs(endOf(a) - endOf(video)) - Math.abs(b.start - video.start) - Math.abs(endOf(b) - endOf(video)))[0];
}

type Speech = { last?: SpokenWord; first?: SpokenWord; clippedOut: boolean; clippedIn: boolean; tail: number; head: number };
/** The words at a sound edit, with the silence on each side in timeline seconds. */
function speechAt(outgoing: Clip | undefined, incoming: Clip | undefined, outWords: SpokenWord[] | undefined, inWords: SpokenWord[] | undefined): Speech {
  const speech: Speech = { clippedOut: false, clippedIn: false, tail: Infinity, head: Infinity };
  if (outgoing && outWords) {
    const end = sourceEndOf(outgoing);
    speech.last = [...outWords].reverse().find(word => word.start <= end - WORD_MARGIN && word.end > outgoing.sourceStart);
    if (speech.last) { speech.clippedOut = speech.last.end > end + WORD_MARGIN; speech.tail = Math.max(0, end - speech.last.end) / playbackRateOf(outgoing); }
  }
  if (incoming && inWords) {
    const start = incoming.sourceStart;
    speech.first = inWords.find(word => word.end >= start + WORD_MARGIN && word.start < sourceEndOf(incoming));
    if (speech.first) { speech.clippedIn = speech.first.start < start - WORD_MARGIN; speech.head = Math.max(0, speech.first.start - start) / playbackRateOf(incoming); }
  }
  return speech;
}
const quoted = (word?: SpokenWord) => word ? `"${word.text.trim().slice(0, 24)}"` : '(no word)';

const replace = (timeline: Timeline, ...clips: Clip[]): Timeline => ({ ...timeline, clips: timeline.clips.map(clip => clips.find(next => next.id === clip.id) ?? clip) });
/** Move one edge of a clip, keeping the source it plays in sync and its fades anchored. */
function withEdges(clip: Clip, start: number, end: number): Clip {
  const delta = start - clip.start;
  const moved = Math.abs(delta) < 1e-9 ? { ...clip, duration: end - start }
    : { ...clip, ...offsetClipMotion(clip, delta), start, sourceStart: Math.max(0, clip.sourceStart + sourceSpanOf(clip, delta)), duration: end - start };
  return { ...moved, ...anchoredFadeTimingPatch(clip, moved) };
}

/**
 * J and L cuts, set (not added): each cut's picture edit is placed `frames` after (J) or before (L) the
 * sound edit, wherever it was. The sound edit is where the words put it and stays there, so cleaned
 * speech and captions keep their timing; only a sound edit that clips a word is moved to that word's
 * edge when the other side has silence to give. Picture and sound keep playing the same source moment,
 * the picture stays gapless, and calling this twice changes nothing.
 */
export function applySplitEdits(input: Timeline, request: SplitEditRequest, sources: SplitEditSources): SplitEditResult {
  let timeline = normalizeTimeline(input);
  const fps = timeline.fps, frame = 1 / fps;
  const applied: SplitEditOutcome[] = [], skipped: SplitEditSkip[] = [];
  let unchanged = 0;
  const maxFrames = Math.floor(MAX_SPLIT_EDIT_SECONDS * fps);
  const minFrames = Math.max(2, Math.ceil(MIN_SPLIT_EDIT_SECONDS * fps - 1e-9));
  // A request under the audible minimum is raised to it; the per-cut limits below may still skip the cut.
  const framesOf = (value: number | undefined) => Math.min(maxFrames, Math.max(minFrames, Math.round(value ?? request.frames ?? defaultSplitEditFrames(fps))));
  const track = request.track ?? mainTrack(timeline);

  // Resolve every requested cut before anything changes.
  const targets: { outgoingId: string; incomingId: string; type: SplitEditType; frames: number }[] = [];
  const add = (join: Join, cut?: SplitCut) => {
    if (targets.some(target => target.outgoingId === join.outgoing.id)) { if (cut) skipped.push({ at: round(endOf(join.outgoing)), clipId: join.outgoing.id, reason: 'Named twice in this call; the first entry for this cut was used.' }); return; }
    targets.push({ outgoingId: join.outgoing.id, incomingId: join.incoming.id, type: cut?.type ?? request.type ?? 'auto', frames: framesOf(cut?.frames) });
  };
  if (request.cuts) {
    for (const cut of request.cuts) {
      // With both, clipId names the cut; at is the fallback when that clip has no cut after it (a stale id, or the clip after it).
      const clip = cut.clipId !== undefined ? timeline.clips.find(item => item.id === cut.clipId) : undefined;
      // The sound clip of a shot names the same cut.
      const video = clip?.kind === 'audio' ? timeline.clips.find(item => item.kind === 'video' && soundOf(timeline, item, sources.audioAssetOf)?.id === clip.id) : clip;
      const named = video?.kind === 'video' ? joinsOn(timeline, trackOf(video)).find(item => item.outgoing.id === video.id) : undefined;
      if (cut.clipId !== undefined && (named || cut.at === undefined)) {
        if (named) add(named, cut);
        else skipped.push({ at: round(video ? endOf(video) : 0), clipId: cut.clipId, reason: !video || video.kind !== 'video' ? 'Not a video clip on this timeline.' : 'No video clip directly follows this one on its layer, so there is no cut here.' });
      } else if (cut.at !== undefined) {
        // A set split edit has two times, the picture edit and the sound edit: either names it.
        const time = cut.at, near = joinsOn(timeline, track).map(join => {
          const sound = soundOf(timeline, join.incoming, sources.audioAssetOf);
          return { join, distance: Math.min(Math.abs(endOf(join.outgoing) - time), sound ? Math.abs(sound.start - time) : Infinity) };
        }).sort((a, b) => a.distance - b.distance)[0];
        if (near && near.distance <= AT_TOLERANCE) add(near.join, cut);
        else skipped.push({ at: round(time), reason: `No video cut near ${round(time)} s on V${track}.` });
      }
    }
  } else {
    for (const join of joinsOn(timeline, track)) {
      const cut = endOf(join.outgoing);
      if (!request.range || cut >= request.range.start - EPSILON && cut <= request.range.end + EPSILON) add(join);
    }
  }
  targets.sort((a, b) => (timeline.clips.find(clip => clip.id === a.outgoingId)?.start ?? 0) - (timeline.clips.find(clip => clip.id === b.outgoingId)?.start ?? 0));

  for (const target of targets) {
    const find = (id: string) => timeline.clips.find(clip => clip.id === id)!;
    let outgoing = find(target.outgoingId), incoming = find(target.incomingId);
    const cut = endOf(outgoing);
    // Reported at the sound edit once it is known: that is the time the words and captions share.
    let reportAt = cut;
    // A skipped cut is left exactly as it was, including a sound edit moved for it below.
    const untouched = timeline;
    const skip = (reason: string) => { timeline = untouched; skipped.push({ at: round(reportAt), clipId: outgoing.id, reason }); };
    const ids = new Set([outgoing.id, incoming.id]);
    if (timeline.clips.some(clip => isTransitionClip(clip) && clip.transition && (ids.has(clip.transition.fromClipId) || ids.has(clip.transition.toClipId)))) { skip('A transition sits on this cut; remove it first.'); continue; }
    if (outgoing.speedRamp?.length || incoming.speedRamp?.length) { skip('A speed ramp runs through this cut.'); continue; }
    if (stackedMirrorCopies(timeline, outgoing.id).length || stackedMirrorCopies(timeline, incoming.id).length) { skip('These shots use the older stacked mirror-blur copies, which would not follow the picture edit; apply the mirror-blur layout again first.'); continue; }
    let outSound = soundOf(timeline, outgoing, sources.audioAssetOf), inSound = soundOf(timeline, incoming, sources.audioAssetOf);
    if (outSound && outSound.id === inSound?.id) { skip('One sound clip plays through this cut, so there is no sound edit to lead or trail.'); continue; }
    if (!outSound && !inSound) { skip('Neither clip has a separate sound clip in sync with it, so there is no sound to lead or trail.'); continue; }
    reportAt = inSound ? inSound.start : endOf(outSound!);
    const contiguous = !!outSound && !!inSound && Math.abs(endOf(outSound) - inSound.start) < frame / 2;
    const sameTake = contiguous && outSound!.assetId === inSound!.assetId && Math.abs(playbackRateOf(outSound!) - playbackRateOf(inSound!)) < 1e-6
      && Math.abs(inSound!.sourceStart - sourceEndOf(outSound!)) < 1.5 * frame * playbackRateOf(inSound!);
    if (sameTake && target.type !== 'none') { skip('Both sides are one continuous take: nothing was removed here, so a J or L cut changes nothing.'); continue; }

    let speech = speechAt(outSound, inSound, outgoing.assetId ? sources.words(outgoing.assetId) : undefined, incoming.assetId ? sources.words(incoming.assetId) : undefined);
    // A sound edit inside a word moves to the word's edge when the other side has silence to give.
    let soundEditMoved = 0;
    if (target.type !== 'none' && contiguous && trackOf(outSound!) === trackOf(inSound!) && speech.clippedOut !== speech.clippedIn) {
      const edit = endOf(outSound!);
      if (speech.clippedOut) {
        const wanted = Math.ceil((timelineTimeAtSource(outSound!, speech.last!.end) - 1e-6) * fps) / fps, shift = wanted - edit;
        const available = outSound!.assetId ? sources.duration(outSound!.assetId) ?? sources.duration(outgoing.assetId ?? '') : undefined;
        if (shift > 1e-6 && shift <= speech.head + 1e-6 && inSound!.duration - shift >= MIN_PIECE_FRAMES * frame && (available === undefined || sourceEndOf(outSound!) + shift * playbackRateOf(outSound!) <= available + 1e-6)) {
          timeline = replace(timeline, withEdges(outSound!, outSound!.start, wanted), withEdges(inSound!, wanted, endOf(inSound!)));
          soundEditMoved = Math.round(shift * fps);
        }
      } else {
        const wanted = Math.floor((timelineTimeAtSource(inSound!, speech.first!.start) + 1e-6) * fps) / fps, shift = edit - wanted;
        if (shift > 1e-6 && shift <= speech.tail + 1e-6 && outSound!.duration - shift >= MIN_PIECE_FRAMES * frame && inSound!.sourceStart - shift * playbackRateOf(inSound!) >= -1e-6) {
          timeline = replace(timeline, withEdges(outSound!, outSound!.start, wanted), withEdges(inSound!, wanted, endOf(inSound!)));
          soundEditMoved = -Math.round(shift * fps);
        }
      }
      if (soundEditMoved) {
        outSound = find(outSound!.id); inSound = find(inSound!.id);
        speech = speechAt(outSound, inSound, sources.words(outgoing.assetId ?? ''), sources.words(incoming.assetId ?? ''));
      }
    }

    // How far each kind may go: the picture needs source footage beside the piece, and each piece keeps its middle.
    const offset = target.frames * frame;
    // Measured on the sound pieces, which this edit never resizes, so a second call finds the same room.
    const outLimit = outSound?.duration ?? Infinity, inLimit = inSound?.duration ?? Infinity;
    const outSource = outgoing.assetId ? sources.duration(outgoing.assetId) : undefined;
    const outPictureSourceEnd = (at: number) => outgoing.sourceStart + (at - outgoing.start) * playbackRateOf(outgoing);
    const jEdit = inSound ? inSound.start : endOf(outSound!), lEdit = outSound ? endOf(outSound) : inSound!.start;
    // J: the outgoing picture holds on past the sound edit, over the incoming sound.
    const jRoom = Math.min(offset, inLimit * MAX_SHARE, outSource === undefined ? Infinity : (outSource - outPictureSourceEnd(jEdit)) / playbackRateOf(outgoing));
    // L: the incoming picture starts before the sound edit, under the outgoing sound.
    const inPictureSourceAt = (at: number) => incoming.sourceStart + (at - incoming.start) * playbackRateOf(incoming);
    const lRoom = Math.min(offset, outLimit * MAX_SHARE, inPictureSourceAt(lEdit) / playbackRateOf(incoming));
    const framesFor = (room: number) => Math.max(0, Math.floor(room * fps + 1e-6));
    const jFrames = framesFor(jRoom), lFrames = framesFor(lRoom);

    // One short piece never fails the batch: its cut is skipped with what it had room for.
    const shortReason = (wanted: string, room: number) => `Only ${room} ${room === 1 ? 'frame' : 'frames'} of room for a ${wanted} cut here (${Number.isFinite(Math.min(outLimit, inLimit)) ? `the shorter neighbouring piece is ${Math.round(Math.min(outLimit, inLimit) * fps)} frames long, or ` : ''}the source has no more footage beside it); under ${minFrames} frames it would not be heard, so this cut is left as it is.`;
    let kind: 'J' | 'L' | 'none', note: string | undefined;
    if (target.type === 'none') kind = 'none';
    else if (target.type === 'auto') {
      if (!speech.last && !speech.first) { skip('No transcript words at this cut, so auto cannot choose; name J or L to set it anyway.'); continue; }
      // J when the incoming line starts on the edit and whole; L when the outgoing line runs up to it.
      const jGain = !!speech.first && !speech.clippedIn && speech.head < offset - frame / 2 && jFrames >= minFrames;
      const lGain = !!speech.last && speech.tail < offset - frame / 2 && lFrames >= minFrames;
      if (speech.clippedOut && lGain) { kind = 'L'; note = `The outgoing word ${quoted(speech.last)} may be cut short here and the sound edit could not move to its end; check this cut by ear.`; }
      // A sound edit moved to finish the outgoing word rides under the next picture; one moved to restore the incoming word leads.
      else if (soundEditMoved > 0 && lGain) kind = 'L';
      else if (jGain) kind = 'J';
      else if (lGain) kind = 'L';
      else {
        skip(speech.head >= offset - frame / 2 && speech.tail >= offset - frame / 2 ? 'Silence on both sides of this cut: no word to lead in or carry over.'
          : jFrames < minFrames && lFrames < minFrames ? shortReason('J or L', Math.max(jFrames, lFrames))
          : speech.clippedIn ? `The incoming word ${quoted(speech.first)} starts mid-word here; fix the cut first.` : `Nothing to gain here: ${shortReason(speech.head < offset - frame / 2 ? 'J' : 'L', speech.head < offset - frame / 2 ? jFrames : lFrames)}`);
        continue;
      }
    } else kind = target.type;
    const frames = kind === 'J' ? jFrames : kind === 'L' ? lFrames : 0;
    if (kind !== 'none' && frames < minFrames) { skip(shortReason(kind, frames)); continue; }
    if (kind !== 'none' && frames < target.frames) note = [note, `Limited to ${frames} of ${target.frames} frames by the footage and piece length available.`].filter(Boolean).join(' ');

    // Place the picture edit. A sound edit off the frame grid keeps its place; the picture edit lands on a frame.
    const reference = kind === 'J' ? jEdit : kind === 'L' ? lEdit : inSound ? inSound.start : endOf(outSound!);
    const wanted = kind === 'none' ? reference : snapTime(reference + (kind === 'J' ? frames : -frames) * frame, fps);
    const picture = Math.min(endOf(incoming) - frame, Math.max(outgoing.start + frame, wanted));
    const before = timeline;
    // Removing a split edit where none is set touches nothing: a pair the user unlinked on purpose stays unlinked.
    if (kind === 'none' && Math.abs(picture - cut) <= 1e-6) { unchanged++; continue; }
    if (Math.abs(picture - cut) > 1e-6) {
      outgoing = withEdges(outgoing, outgoing.start, picture); incoming = withEdges(incoming, picture, endOf(incoming));
      timeline = replace(timeline, outgoing, incoming);
    }
    // A picture that no longer shares its sound's timing cannot stay linked to it; one that does is linked again.
    for (const [video, sound] of [[outgoing, outSound], [incoming, inSound]] as const) {
      if (!sound) continue;
      const aligned = Math.abs(video.start - sound.start) < 1e-7 && Math.abs(video.duration - sound.duration) < 1e-7 && Math.abs(video.sourceStart - sound.sourceStart) < 1e-7;
      const linked = video.linkedClipId === sound.id;
      if (linked && !aligned) timeline = replace(timeline, { ...find(video.id), linkedClipId: undefined }, { ...find(sound.id), linkedClipId: undefined });
      else if (!linked && aligned && video.audioSeparated && !video.linkedClipId && !sound.linkedClipId && !linkProblem(timeline, video, sound, sources.audioAssetOf))
        timeline = replace(timeline, { ...find(video.id), linkedClipId: sound.id }, { ...find(sound.id), linkedClipId: video.id });
    }
    if (request.fadeFrames !== undefined && kind !== 'none') {
      for (const [sound, key] of [[outSound, 'fadeOut'], [inSound, 'fadeIn']] as const) {
        if (!sound) continue;
        const current = find(sound.id), fade = Math.min(request.fadeFrames * frame, current.duration / 2);
        if (Math.abs((current.audio?.[key] ?? 0) - fade) > 1e-9) timeline = replace(timeline, { ...current, ...audioSettingsPatch(current, key === 'fadeOut' ? { fadeOut: fade } : { fadeIn: fade }) });
      }
    }
    if (timeline === before && !soundEditMoved) { unchanged++; }
    const words = speech.last || speech.first ? `${quoted(speech.last)} | ${quoted(speech.first)}` : undefined;
    applied.push({ at: round(reference), clipId: outgoing.id, nextClipId: incoming.id, type: kind, frames, ...(words ? { words } : {}), ...(soundEditMoved ? { soundEditMoved } : {}), ...(note ? { note } : {}) });
  }
  return { timeline, applied, skipped, unchanged };
}
