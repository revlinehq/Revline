import type { ApprovedSection, Clip, ClipApproval, Timeline } from './types';

/**
 * Approved work: the user signed off on a clip, or on a section of a film, and editing agents must
 * leave it as it is. Approval lives on the clip (`approval`, `approvedSections`), so it moves, splits
 * and duplicates with it. Agents refuse any edit that changes approved work unless the call passes
 * an override with the reason the user gave; the user edits it freely in the editor.
 */

const EPSILON = 1e-4;
export const APPROVAL_NOTE_LIMIT = 300;

const cleanNote = (note?: string) => note?.trim().slice(0, APPROVAL_NOTE_LIMIT) || undefined;
const approvalOf = (note: string | undefined, by: ClipApproval['by']): ClipApproval => ({ ...(cleanNote(note) ? { note: cleanNote(note) } : {}), at: Date.now(), by });
const clipName = (clip: Clip) => clip.scene?.title || clip.text?.slice(0, 40) || clip.kind;
const round = (value: number) => Math.round(value * 1000) / 1000;
/** A film or a split scene is several clips showing one code; an approved section belongs to all of them. */
const sharesScene = (clip: Clip, other: Clip) => other.id === clip.id || (clip.kind === 'scene' && other.kind === 'scene' && !!clip.scene && other.scene?.code === clip.scene.code);
/** Film seconds shown at a timeline second on this clip. */
export const filmTimeAt = (clip: Clip, time: number) => clip.sourceStart + (time - clip.start) * (clip.playbackRate ?? 1);

/** Approve a whole clip. A linked video/audio pair is approved together, since one edit moves both. */
export function approveClip(timeline: Timeline, clipId: string, note: string | undefined, by: ClipApproval['by']) {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  const ids = new Set([clip.id, ...(clip.linkedClipId ? [clip.linkedClipId] : [])]);
  return { ...timeline, clips: timeline.clips.map(item => ids.has(item.id) ? { ...item, approval: approvalOf(note, by) } : item) };
}

/** The film seconds a marker's section covers: from the marker to the next marker inside the film, or the film's end. */
export function markerSection(timeline: Timeline, clip: Clip, markerId: string) {
  const markers = [...(timeline.markers ?? [])].sort((a, b) => a.time - b.time), marker = markers.find(item => item.id === markerId);
  if (!marker) throw new Error('Marker not found. Read the markers with inspectTimeline.');
  const end = clip.start + clip.duration;
  if (marker.time < clip.start - EPSILON || marker.time >= end - EPSILON) throw new Error(`Marker "${marker.label || marker.id}" is not inside this clip (${round(clip.start)} to ${round(end)}s).`);
  const next = markers.find(item => item.time > marker.time + EPSILON && item.time < end - EPSILON);
  return { start: marker.time, end: next?.time ?? end, label: marker.label };
}

/** Approve one section of a scene or film, given in timeline seconds; every clip of that film carries it in film seconds. */
export function approveSection(timeline: Timeline, clipId: string, range: { start: number; end: number; label?: string }, note: string | undefined, by: ClipApproval['by']) {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (clip.kind !== 'scene' || !clip.scene) throw new Error('Sections can be approved on scene and film clips. Approve other clips whole.');
  const start = Math.max(clip.start, range.start), end = Math.min(clip.start + clip.duration, range.end);
  if (end - start < EPSILON) throw new Error(`The range ${round(range.start)} to ${round(range.end)}s does not overlap this clip (${round(clip.start)} to ${round(clip.start + clip.duration)}s).`);
  const section: ApprovedSection = { ...approvalOf(note, by), id: crypto.randomUUID(), start: round(filmTimeAt(clip, start)), end: round(filmTimeAt(clip, end)), ...(range.label ? { label: range.label } : {}) };
  return { timeline: { ...timeline, clips: timeline.clips.map(item => sharesScene(clip, item) ? { ...item, approvedSections: [...(item.approvedSections ?? []).filter(other => other.start !== section.start || other.end !== section.end), section] } : item) }, section };
}

/** Remove a clip's approval: the whole-clip mark, one section, or (with neither named) everything on it. */
export function unapproveClip(timeline: Timeline, clipId: string, sectionId?: string) {
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (sectionId && !clip.approvedSections?.some(section => section.id === sectionId)) throw new Error('That approved section is not on this clip. Read approvedSections with inspectClip.');
  if (!sectionId && !clip.approval && !clip.approvedSections?.length) throw new Error('This clip is not approved.');
  const pair = new Set([clip.id, ...(clip.linkedClipId ? [clip.linkedClipId] : [])]);
  return { ...timeline, clips: timeline.clips.map(item => {
    const dropWhole = !sectionId && pair.has(item.id), inFilm = sharesScene(clip, item) && !!item.approvedSections;
    if (!dropWhole && !inFilm) return item;
    const { approval, approvedSections, ...rest } = item, kept = sectionId ? (approvedSections ?? []).filter(section => section.id !== sectionId) : [];
    return { ...rest, ...(!dropWhole && approval ? { approval } : {}), ...(kept.length ? { approvedSections: kept } : {}) };
  }) };
}

export const isApproved = (clip: Clip) => !!clip.approval || !!clip.approvedSections?.length;

/** What an agent reads about approved work: each approved clip and section with its note, up front in inspectTimeline. */
export function approvedWork(timeline: Timeline) {
  return timeline.clips.filter(isApproved).map(clip => ({
    clipId: clip.id, kind: clip.kind, name: clipName(clip),
    ...(clip.approval ? { whole: true, note: clip.approval.note ?? null } : {}),
    ...(clip.approvedSections?.length ? { sections: clip.approvedSections.filter(section => section.end > clip.sourceStart && section.start < clip.sourceStart + clip.duration * (clip.playbackRate ?? 1)).map(section => ({ sectionId: section.id, label: section.label ?? null, filmStart: section.start, filmEnd: section.end, timelineStart: round(clip.start + (section.start - clip.sourceStart) / (clip.playbackRate ?? 1)), timelineEnd: round(clip.start + (section.end - clip.sourceStart) / (clip.playbackRate ?? 1)), note: section.note ?? null })) } : {}),
  }));
}

// ---- Which code an approved section owns -------------------------------------------------------

/** Each top-level declaration of a module (any name), with its source up to the next one. */
export function declarations(code: string) {
  const found = [...code.matchAll(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)];
  return new Map(found.map((match, index) => [match[1], code.slice(match.index, found[index + 1]?.index ?? code.length)]));
}
export const identifiers = (code: string) => new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);

/** End of a JSX open tag starting at `from` (the `<`), skipping `>` inside braces and strings. */
function openTagEnd(code: string, from: number) {
  let depth = 0, quote = '';
  for (let at = from + 1; at < code.length; at++) {
    const char = code[at];
    if (quote) { if (char === quote && code[at - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0) return at;
  }
  return -1;
}

/** Every <Beat> in a film's code with its literal start and duration, and the full text of the element (from..to). */
export function filmBeats(code: string) {
  const found: { start?: number; duration?: number; text: string; from: number; to: number }[] = [];
  for (const match of code.matchAll(/<Beat\b/g)) {
    const from = match.index, close = openTagEnd(code, from);
    if (close < 0) continue;
    const tag = code.slice(from, close + 1), number = (name: string) => { const value = new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(-?[\\d.]+)\\s*\\}`).exec(tag)?.[1]; return value === undefined ? undefined : Number(value); };
    let end = close + 1;
    if (!tag.endsWith('/>')) {
      // Match the closing tag, counting Beats nested inside this one.
      const pattern = /<Beat\b|<\/Beat\s*>/g;
      pattern.lastIndex = end;
      for (let depth = 1, next = pattern.exec(code); next; next = pattern.exec(code)) {
        if (next[0].startsWith('</')) { if (--depth === 0) { end = next.index + next[0].length; break; } }
        else { const inner = openTagEnd(code, next.index); if (inner > 0 && code[inner - 1] !== '/') depth++; }
      }
    }
    found.push({ start: number('start'), duration: number('duration'), text: code.slice(from, end), from, to: end });
  }
  return found;
}

/**
 * The code a film section owns: the <Beat>s it overlaps, plus every top-level declaration (component,
 * style object, helper) they reach, walked through the film's own code and its film kit. Comparing
 * this before and after a patch says whether the patch touched the section. Undefined when the code
 * has no <Beat> with literal timing over the section, so the whole film counts.
 */
export function sectionCode(scene: NonNullable<Clip['scene']>, section: { start: number; end: number }) {
  const owned = filmSections(scene).filter(beat => beat.start !== undefined && beat.duration !== undefined && beat.start < section.end - EPSILON && beat.start + beat.duration > section.start + EPSILON);
  if (!owned.length) return undefined;
  return reach(scene, owned.map(beat => beat.text)).parts.join('\n\u0000\n');
}

/**
 * The <Beat>s that time the film itself, with literal start and duration. A Beat inside a component that a timed
 * Beat renders (a section's own inner clock) counts in that component's local time, so it is part of its section.
 */
export function filmSections(scene: NonNullable<Clip['scene']>) {
  const timed = filmBeats(scene.code).filter((beat): beat is ReturnType<typeof filmBeats>[number] & { start: number; duration: number } => beat.start !== undefined && beat.duration !== undefined);
  const spans = [...declarations(scene.code)].map(([name, body]) => { const from = scene.code.indexOf(body); return { name, from, to: from + body.length }; });
  const container = new Map(timed.map(beat => [beat, spans.find(span => span.from <= beat.from && span.to >= beat.to)?.name]));
  let kept = timed;
  for (let round = 0; round < 6; round++) {
    const inner = reach(scene, kept.map(beat => beat.text)).names, next = timed.filter(beat => { const name = container.get(beat); return !name || !inner.has(name); });
    if (next.length === kept.length) break;
    kept = next;
  }
  return kept;
}

/** Code and the top-level names it reaches, walked through the film's own declarations and its film kit. The root component is never walked into. */
export function reach(scene: NonNullable<Clip['scene']>, texts: string[]) {
  const scopes = [declarations(scene.code), ...(scene.blueprints ?? []).map(item => declarations(item.code))];
  // The film's root component holds the Beats themselves; only the Beats count, not its other children.
  const root = rootName(scene.code);
  const parts = [...texts], seen = new Set<string>(root ? [root] : []), names = new Set<string>();
  for (let index = 0; index < parts.length; index++) for (const name of identifiers(parts[index])) {
    if (seen.has(name)) continue;
    seen.add(name);
    for (const scope of scopes) { const body = scope.get(name); if (body !== undefined) { parts.push(`${name}:${body}`); names.add(name); } }
  }
  return { parts, names };
}
export const rootName = (code: string) => /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/.exec(code)?.[1];

// ---- The guard ---------------------------------------------------------------------------------

export type ApprovalViolation = { clipId: string; name: string; what: string; note?: string; sectionId?: string };

/** A clip compared with its approval marks and the given fields left out. */
const comparable = (clip: Clip, omit: readonly string[]) => {
  const { approval: _approval, approvedSections: _sections, ...rest } = clip as Clip & Record<string, unknown>;
  const scene = rest.scene ? { ...rest.scene } as Record<string, unknown> : undefined;
  const copy = { ...rest, ...(scene ? { scene } : {}) } as Record<string, unknown>;
  for (const field of omit) if (field.startsWith('scene.')) delete scene?.[field.slice(6)]; else delete copy[field];
  return JSON.stringify(copy);
};
// Layer numbers shift when tracks are added, removed or reordered; that is not an edit of the clip.
const WHOLE_IGNORED = ['track'] as const;
// A film with an approved section may move, and its other sections may change.
const SECTION_IGNORED = ['track', 'start', 'duration', 'sourceStart', 'scene.code', 'scene.codeRef', 'scene.blueprints'] as const;

/** Whether film seconds start..end are on screen across these windows onto one film. */
function shown(clips: Clip[], section: { start: number; end: number }) {
  const windows = clips.map(clip => [clip.sourceStart, clip.sourceStart + clip.duration * (clip.playbackRate ?? 1)] as const).sort((a, b) => a[0] - b[0]);
  let reached = section.start;
  for (const [from, to] of windows) if (from <= reached + EPSILON && to > reached) reached = to;
  return reached >= section.end - EPSILON;
}

/** Every change from `before` to `after` that touches approved work. Approval marks themselves are changed by their own tools. */
export function approvalViolations(before: Timeline, after: Timeline): ApprovalViolation[] {
  const next = new Map(after.clips.map(clip => [clip.id, clip])), violations: ApprovalViolation[] = [];
  for (const clip of before.clips) {
    if (!isApproved(clip)) continue;
    const current = next.get(clip.id), name = clipName(clip);
    if (clip.approval) {
      if (!current) { violations.push({ clipId: clip.id, name, what: 'delete it', note: clip.approval.note }); continue; }
      if (comparable(clip, WHOLE_IGNORED) !== comparable(current, WHOLE_IGNORED)) violations.push({ clipId: clip.id, name, what: 'change it', note: clip.approval.note });
      continue;
    }
    for (const section of clip.approvedSections ?? []) {
      const label = `section ${section.label ? `"${section.label}" ` : ''}(film ${section.start} to ${section.end}s)`;
      const carriers = (timeline: Timeline) => timeline.clips.filter(item => item.approvedSections?.some(other => other.id === section.id));
      const was = carriers(before), now = carriers(after);
      if (was[0]?.id !== clip.id) continue; // checked once per section, on its first clip
      if (shown(was, section) && !shown(now, section)) { violations.push({ clipId: clip.id, name, what: `cut or delete its approved ${label}`, note: section.note, sectionId: section.id }); continue; }
      const changed = was.find(item => { const later = next.get(item.id); return later && comparable(item, SECTION_IGNORED) !== comparable(later, SECTION_IGNORED); });
      if (changed) { violations.push({ clipId: clip.id, name, what: `change settings over its approved ${label}`, note: section.note, sectionId: section.id }); continue; }
      const scene = clip.scene, later = now.find(item => item.scene)?.scene;
      if (!scene || !later || (scene.code === later.code && scene.codeRef === later.codeRef && JSON.stringify(scene.blueprints ?? []) === JSON.stringify(later.blueprints ?? []))) continue;
      const owned = sectionCode(scene, section);
      if (owned === undefined) violations.push({ clipId: clip.id, name, what: `change its code, and its approved ${label} has no <Beat> with literal start and duration to tell it apart, so any code change counts`, note: section.note, sectionId: section.id });
      else if (owned !== sectionCode(later, section)) violations.push({ clipId: clip.id, name, what: `change the code of its approved ${label} (its <Beat> or a component, style or helper it uses)`, note: section.note, sectionId: section.id });
    }
  }
  return violations;
}

/** The refusal an agent reads: what is approved, why, and how to go on. */
export function approvalRefusal(violations: ApprovalViolation[]) {
  const lines = violations.map(item => `${item.name} (${item.clipId}) is approved${item.note ? ` ("${item.note}")` : ''}; this edit would ${item.what}.`);
  return `Nothing was changed. ${lines.join(' ')} Approved work is off-limits: leave it as it is and edit around it, or ask the user. Only if the user asked for this exact change, call the tool again with overrideApproved: true and overrideReason quoting what the user asked.`;
}
