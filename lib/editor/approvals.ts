import { equalTimelineValue } from './timeline-equality';
import type { Clip, ClipApproval, Timeline } from './types';

/**
 * Approved work: the user signed off on a clip, and editing agents must leave it as it is. Approval
 * lives on the clip (`approval`), so it moves, splits and duplicates with it. Agents refuse any edit
 * that changes approved work unless the call passes an override with the reason the user gave; the
 * user edits it freely in the editor.
 */

export const APPROVAL_NOTE_LIMIT = 300;

const cleanNote = (note?: string) => note?.trim().slice(0, APPROVAL_NOTE_LIMIT) || undefined;
const approvalOf = (note: string | undefined, by: ClipApproval['by']): ClipApproval => ({ ...(cleanNote(note) ? { note: cleanNote(note) } : {}), at: Date.now(), by });
const clipName = (clip: Clip) => clip.text?.slice(0, 40) || clip.kind;

/** Approve a whole clip. A linked video/audio pair is approved together, since one edit moves both. */
export function approveClip(timeline: Timeline, clipId: string, note: string | undefined, by: ClipApproval['by']) {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  const ids = new Set([clip.id, ...(clip.linkedClipId ? [clip.linkedClipId] : [])]);
  return { ...timeline, clips: timeline.clips.map(item => ids.has(item.id) ? { ...item, approval: approvalOf(note, by) } : item) };
}

/** Remove a clip's approval, and its linked clip's with it. */
export function unapproveClip(timeline: Timeline, clipId: string) {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (!clip.approval) throw new Error('This clip is not approved.');
  const pair = new Set([clip.id, ...(clip.linkedClipId ? [clip.linkedClipId] : [])]);
  return { ...timeline, clips: timeline.clips.map(item => {
    if (!pair.has(item.id)) return item;
    const { approval: _approval, ...rest } = item;
    return rest;
  }) };
}

export const isApproved = (clip: Clip) => !!clip.approval;

/** What an agent reads about approved work: each approved clip with its note, up front in inspectTimeline. */
export function approvedWork(timeline: Timeline) {
  return timeline.clips.filter(isApproved).map(clip => ({ clipId: clip.id, kind: clip.kind, name: clipName(clip), whole: true, note: clip.approval?.note ?? null }));
}

// ---- The guard ---------------------------------------------------------------------------------

export type ApprovalViolation = { clipId: string; name: string; what: string; note?: string };

/** A clip compared without its approval mark and layer number: layers shift when tracks are added, removed or reordered. */
const comparable = (clip: Clip) => {
  const { approval: _approval, track: _track, ...rest } = clip;
  return JSON.stringify(rest);
};

/** Every change from `before` to `after` that touches approved work. Approval marks themselves are changed by their own tools. */
export function approvalViolations(before: Timeline, after: Timeline): ApprovalViolation[] {
  const next = new Map(after.clips.map(clip => [clip.id, clip])), violations: ApprovalViolation[] = [];
  const masterChanged = !equalTimelineValue(before.audioNormalization, after.audioNormalization);
  for (const clip of before.clips) {
    if (!clip.approval) continue;
    const current = next.get(clip.id), name = clipName(clip);
    if (masterChanged && (clip.kind === 'audio' || clip.kind === 'video') && (clip.volume ?? 1) > 0) { violations.push({ clipId: clip.id, name, what: 'change its sound through timeline loudness normalization', note: clip.approval.note }); continue; }
    if (!current) { violations.push({ clipId: clip.id, name, what: 'delete it', note: clip.approval.note }); continue; }
    if (comparable(clip) !== comparable(current)) violations.push({ clipId: clip.id, name, what: 'change it', note: clip.approval.note });
  }
  return violations;
}

/** The refusal an agent reads: what is approved, why, and how to go on. */
export function approvalRefusal(violations: ApprovalViolation[]) {
  const lines = violations.map(item => `${item.name} (${item.clipId}) is approved${item.note ? ` ("${item.note}")` : ''}; this edit would ${item.what}.`);
  return `Nothing was changed. ${lines.join(' ')} Approved work is off-limits: leave it as it is and edit around it, or ask the user. Only if the user asked for this exact change, call the tool again with overrideApproved: true and overrideReason quoting what the user asked.`;
}
