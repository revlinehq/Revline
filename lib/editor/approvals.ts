import { equalTimelineValue } from './timeline-equality';
import { sectionMarkersIn } from './timeline-markers';
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
  const marker = timeline.markers?.find(item => item.id === markerId);
  if (!marker) throw new Error('Marker not found. Read the markers with inspectTimeline.');
  const end = clip.start + clip.duration;
  if (marker.time < clip.start - EPSILON || marker.time >= end - EPSILON) throw new Error(`Marker "${marker.label || marker.id}" is not inside this clip (${round(clip.start)} to ${round(end)}s).`);
  const next = sectionMarkersIn(timeline, clip).find(item => item.time > marker.time + EPSILON && item.time < end - EPSILON);
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

/** Index just past the string, template literal or comment starting at `at`, or `at` itself when none starts there. */
export function skipText(code: string, at: number): number {
  const char = code[at];
  if (char === '/' && code[at + 1] === '/') { const end = code.indexOf('\n', at); return end < 0 ? code.length : end; }
  if (char === '/' && code[at + 1] === '*') { const end = code.indexOf('*/', at + 2); return end < 0 ? code.length : end + 2; }
  if (char !== '"' && char !== "'" && char !== '`') return at;
  for (let next = at + 1; next < code.length; next++) {
    if (code[next] === '\\') { next++; continue; }
    if (code[next] === char) return next + 1;
    if (char === '`' && code[next] === '$' && code[next + 1] === '{') { const close = closeOf(code, next + 2); if (close < 0) return code.length; next = close - 1; }
  }
  return code.length;
}

/** Index just past the bracket that closes the one opened right before `from`; -1 if it never closes. */
function closeOf(code: string, from: number) {
  let depth = 1;
  for (let at = from; at < code.length; at++) {
    const skipped = skipText(code, at);
    if (skipped !== at) { at = skipped - 1; continue; }
    const char = code[at];
    if (char === '(' || char === '[' || char === '{') depth++;
    else if ((char === ')' || char === ']' || char === '}') && --depth === 0) return at + 1;
  }
  return -1;
}

/** The trimmed top-level arguments of a call whose "(" ends at `from` and whose ")" is at `to - 1`. */
function callArguments(code: string, from: number, to: number) {
  const args: string[] = [];
  let start = from;
  for (let at = from; at < to - 1; at++) {
    const skipped = skipText(code, at);
    if (skipped !== at) { at = skipped - 1; continue; }
    const char = code[at];
    if (char === '(' || char === '[' || char === '{') { const close = closeOf(code, at + 1); if (close < 0) break; at = close - 1; }
    else if (char === ',') { args.push(code.slice(start, at)); start = at + 1; }
  }
  args.push(code.slice(start, to - 1));
  return args.map(arg => arg.trim());
}

const literalNumber = (text: string | undefined) => text !== undefined && /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : undefined;
const literalString = (text: string | undefined) => text !== undefined && /^(['"`])(?:(?!\1)[^\\$]|\\.)*\1$/.test(text) ? text.slice(1, -1) : undefined;

/**
 * Every `section(name, start, duration, build)` call in a film's code: its literal name, start and duration (film
 * seconds; undefined when not a plain literal) and the full text of the call (from..to). The call is the code the
 * section owns.
 */
export function sectionCalls(code: string) {
  const found: { name?: string; start?: number; duration?: number; text: string; from: number; to: number }[] = [];
  // Strings and comments are blanked first, so a "section(" in text or a comment is not a call.
  let masked = '';
  for (let at = 0; at < code.length;) { const skipped = skipText(code, at); if (skipped === at) { masked += code[at]; at++; } else { masked += code.slice(at, skipped).replace(/[^\n]/g, ' '); at = skipped; } }
  for (const match of masked.matchAll(/(?<![\w$.])section\s*\(/g)) {
    if (/\bfunction\s*$/.test(masked.slice(Math.max(0, match.index - 12), match.index))) continue;
    const open = match.index + match[0].length, end = closeOf(code, open);
    if (end < 0) continue;
    const [name, start, duration] = callArguments(code, open, end);
    found.push({ name: literalString(name), start: literalNumber(start), duration: literalNumber(duration), text: code.slice(match.index, end), from: match.index, to: end });
  }
  // Sections do not nest: a call inside another one is part of it.
  return found.filter(call => !found.some(other => other !== call && other.from <= call.from && other.to >= call.to));
}

/** The code a film section owns: the section() calls it overlaps, plus every top-level declaration they reach. Comparing
 * this before and after a patch says whether the patch touched the section. Undefined when no call with literal timing
 * covers the section, so the whole film counts. */
function sectionCode(scene: NonNullable<Clip['scene']>, section: { start: number; end: number }) {
  const owned = filmSections(scene).filter(call => call.start < section.end - EPSILON && call.start + call.duration > section.start + EPSILON);
  if (!owned.length) return undefined;
  return reach(scene, owned.map(call => call.text)).parts.join('\n\u0000\n');
}

export type FilmSection = ReturnType<typeof sectionCalls>[number] & { start: number; duration: number };
/** The section() calls with literal start and duration: they time the film. */
export const filmSections = (scene: { code: string }) => sectionCalls(scene.code).filter((call): call is FilmSection => call.start !== undefined && call.duration !== undefined);

/** A film's section() calls checked against the film: literal timing, inside the film, in order without overlap. */
export function checkSectionCalls(code: string, filmDuration: number) {
  const calls = sectionCalls(code), problems: string[] = [];
  for (const call of calls) {
    const head = call.text.slice(0, 80).replace(/\s+/g, ' ');
    if (call.name === undefined || call.start === undefined || call.duration === undefined) problems.push(`${head}... needs a string literal name and number literals for start and duration, like section('Hook', 0, 3.5, (tl) => { ... }).`);
    else if (call.duration <= 0 || call.start + call.duration > filmDuration + EPSILON) problems.push(`Section "${call.name}" (${call.start} + ${call.duration}s) must run inside the film (0 to ${filmDuration}s).`);
  }
  const timed = calls.filter((call): call is FilmSection => call.start !== undefined && call.duration !== undefined).sort((a, b) => a.start - b.start);
  for (let index = 1; index < timed.length; index++) if (timed[index].start < timed[index - 1].start + timed[index - 1].duration - EPSILON) problems.push(`Sections "${timed[index - 1].name}" and "${timed[index].name}" overlap; each section must end at or before the next one starts. Put a move that spans both on the outer tl.`);
  if (problems.length) throw new Error(`Nothing was saved. ${problems.join(' ')}`);
  return timed;
}

/** addFilm: every section() call names one of the film's sections by title and start, and every section the call
 * implements (starting before builtThrough) has its call, so markers, inspectClip and approvals agree with the code. */
export function checkFilmSections(code: string, filmDuration: number, sections: { title: string; at: number }[], builtThrough = filmDuration) {
  const calls = checkSectionCalls(code, filmDuration), key = (title: string) => title.trim().toLowerCase(), problems: string[] = [];
  for (const call of calls) if (!sections.some(item => key(item.title) === key(call.name!) && Math.abs(item.at - call.start) < 1e-3)) problems.push(`section('${call.name}', ${call.start}, ...) is not in sections; add { title: '${call.name}', at: ${call.start} } or match an existing one's title and start.`);
  for (const item of sections) if (item.at < builtThrough - EPSILON && !calls.some(call => key(call.name!) === key(item.title) && Math.abs(item.at - call.start) < 1e-3)) problems.push(`Section "${item.title}" at ${item.at}s has no section('${item.title}', ${item.at}, <duration>, (tl) => { ... }) call${builtThrough < filmDuration ? `; it starts before builtThrough (${builtThrough}s)` : ''}.`);
  if (problems.length) throw new Error(`Nothing was saved. ${problems.join(' ')}`);
  return calls;
}

/** Code and the top-level names it reaches, walked through the film's own declarations. The default export is never walked into. */
export function reach(scene: { code: string }, texts: string[]) {
  const scopes = [declarations(scene.code)];
  // The default export holds the section() calls themselves; only the calls count, not the rest of its body.
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
  const masterChanged=!equalTimelineValue(before.audioNormalization,after.audioNormalization);
  for (const clip of before.clips) {
    if (!isApproved(clip)) continue;
    const current = next.get(clip.id), name = clipName(clip);
    if(masterChanged&&(clip.kind==='audio'||clip.kind==='video')&&(clip.volume??1)>0){violations.push({clipId:clip.id,name,what:'change its sound through timeline loudness normalization',note:clip.approval?.note});continue;}
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
      if (owned === undefined) violations.push({ clipId: clip.id, name, what: `change its code, and its approved ${label} has no section() call with literal start and duration to tell it apart, so any code change counts`, note: section.note, sectionId: section.id });
      else if (owned !== sectionCode(later, section)) violations.push({ clipId: clip.id, name, what: `change the code of its approved ${label} (its section() call or a helper or style it uses)`, note: section.note, sectionId: section.id });
    }
  }
  return violations;
}

/** The refusal an agent reads: what is approved, why, and how to go on. */
export function approvalRefusal(violations: ApprovalViolation[]) {
  const lines = violations.map(item => `${item.name} (${item.clipId}) is approved${item.note ? ` ("${item.note}")` : ''}; this edit would ${item.what}.`);
  return `Nothing was changed. ${lines.join(' ')} Approved work is off-limits: leave it as it is and edit around it, or ask the user. Only if the user asked for this exact change, call the tool again with overrideApproved: true and overrideReason quoting what the user asked.`;
}
