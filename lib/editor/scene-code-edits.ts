import { declarations, filmSections, filmTimeAt, markerSection, reach } from './approvals';
import { diffArrays } from 'diff';
import { closestCodeLines, sceneSnippetMatches, type SceneEdit } from './scene-film';
import type { Clip, Timeline } from './types';

export type CodeLines = { start: number; end: number };
export type SceneLineEdit = { lines: CodeLines; replace: string; insert?: 'before' | 'after' };
type Span = { from: number; to: number };
type CodeSelection = { section?: string; lines?: CodeLines };
export type CodeSearch = { query: string; regex?: boolean; caseSensitive?: boolean; startLine?: number; limit?: number };

export function sceneCodeSource(clip: Clip) {
  if (clip.kind !== 'scene' || !clip.scene) throw new Error('Choose a scene clip.');
  return clip.scene.code;
}

const lineAt = (code: string, offset: number) => code.slice(0, offset).split('\n').length;
const contains = (outer: Span, inner: Span) => outer.from <= inner.from && outer.to >= inner.to;
const intersects = (a: Span, b: Span) => a.from < b.to && b.from < a.to;
function mergeSpans(spans: Span[]) {
  const merged: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && last.to >= span.from) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

function lineSpan(code: string, lines: CodeLines): Span {
  const rows = code.split('\n');
  if (!Number.isInteger(lines.start) || !Number.isInteger(lines.end) || lines.start < 1 || lines.end < lines.start || lines.end > rows.length) throw new Error(`Choose an inclusive line range from 1 to ${rows.length}. Read inspectClip again for current line numbers. Nothing was changed.`);
  const from = rows.slice(0, lines.start - 1).reduce((total, line) => total + line.length + 1, 0);
  return { from, to: from + rows.slice(lines.start - 1, lines.end).join('\n').length };
}

/** Reads stay useful when a caller asks past EOF; writes still require exact valid bounds. */
function readLines(code: string, lines: CodeLines) {
  if (!Number.isInteger(lines.start) || !Number.isInteger(lines.end) || lines.end < lines.start) throw new Error('lines.end must be at least lines.start, both integer line numbers.');
  const last = code.split('\n').length;
  return { start: Math.max(1, Math.min(last, lines.start)), end: Math.max(1, Math.min(last, lines.end)) };
}

/** Timeline markers name sections; their timed section() calls reach the code each section uses. */
function sections(timeline: Timeline, clip: Clip, code: string) {
  const scene = clip.scene;
  if (!scene) return [];
  const beats = filmSections(scene), bodies = declarations(code);
  return (timeline.markers ?? []).filter(marker => marker.time >= clip.start && marker.time < clip.start + clip.duration).map(marker => {
    const range = markerSection(timeline, clip, marker.id), start = filmTimeAt(clip, range.start), end = filmTimeAt(clip, range.end);
    const owned = beats.filter(beat => beat.start < end - 1e-4 && beat.start + beat.duration > start + 1e-4);
    const names = reach(scene, owned.map(beat => beat.text)).names;
    const spans = mergeSpans([...owned.map(({ from, to }) => ({ from, to })), ...[...names].flatMap(name => {
      const body = bodies.get(name);
      if (body === undefined) return [];
      const from = code.indexOf(body);
      return [{ from, to: from + body.length }];
    })]);
    return { id: marker.id, label: marker.label ?? marker.id, start, end, spans };
  });
}

function selection(timeline: Timeline, clip: Clip, options: CodeSelection) {
  const code = sceneCodeSource(clip), named = sections(timeline, clip, code);
  const wanted = options.section?.trim().toLowerCase();
  const matches = wanted ? named.filter(item => item.id === options.section || item.label.trim().toLowerCase() === wanted) : [];
  if (wanted && matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Unknown'} section "${options.section}". Sections: ${named.map(item => `"${item.label}" (${item.id})`).join(', ') || 'none; use whole-scene line ranges'}. Nothing was changed.`);
  const section = matches[0];
  const spans = section?.spans.length ? section.spans : [{ from: 0, to: code.length }];
  const warnings: string[] = [];
  if (section && !section.spans.length) warnings.push('This marker has no section() call with literal timing that identifies its code. Falling back to whole-scene line ranges; edits can affect other sections and their transitions.');
  else if (section && named.some(other => other !== section && other.spans.some(span => spans.some(owned => intersects(span, owned))))) warnings.push('Some returned code is shared with other sections, including any section() spanning a boundary. Changes to it can affect their transitions.');
  if (named.some(item => !item.spans.length && item !== section)) warnings.push('Some section markers have no section() call with literal timing, so their code ownership cannot be isolated. Edits may affect those sections and their transitions; inspect both sides of their boundaries.');
  return { code, named, section, spans, warnings };
}

const spanLines = (code: string, span: Span): CodeLines => ({ start: lineAt(code, span.from), end: lineAt(code, span.to === code.length ? span.to : Math.max(span.from, span.to - 1)) });
function block(code: string, { start: startLine, end: endLine }: CodeLines) {
  const text = code.split('\n').slice(startLine - 1, endLine).join('\n');
  return { startLine, endLine, code: text, numberedCode: text.split('\n').map((line, index) => `${startLine + index}: ${line}`).join('\n') };
}

/** Only the selected source is returned; line numbers always address the full current module. */
export function inspectSceneCode(timeline: Timeline, clip: Clip, options: CodeSelection) {
  const { code, named, section, spans, warnings } = selection(timeline, clip, options);
  const lines = options.lines ? readLines(code, options.lines) : undefined;
  const ranges = spans.map(span => spanLines(code, span)).map(range => lines ? { start: Math.max(range.start, lines.start), end: Math.min(range.end, lines.end) } : range).filter(range => range.start <= range.end);
  if (!ranges.length) warnings.push('The requested lines do not intersect this section. Omit lines to read its code blocks.');
  const blocks = mergeSpans(ranges.map(range => ({ from: range.start, to: range.end }))).map(span => block(code, { start: span.from, end: span.to }));
  return {
    totalLines: code.split('\n').length,
    ...(lines ? { requestedLines: options.lines, lines, clamped: lines.start !== options.lines!.start || lines.end !== options.lines!.end } : {}),
    ...(section ? { section: section.label } : {}), blocks,
    sections: named.map(({ spans: owned, ...item }) => ({ ...item, blocks: owned.map(span => ({ startLine: spanLines(code, span).start, endLine: spanLines(code, span).end })) })),
    warnings,
    note: 'Line numbers are absolute, 1-based and inclusive for this source snapshot. Copy from code, or omit numberedCode prefixes. Reinspect after a successful patch. Line edits in one call all address this snapshot.',
  };
}

/** Search selected code without returning the whole module; matches keep absolute snapshot coordinates. */
export function searchSceneCode(timeline: Timeline, clip: Clip, options: CodeSelection, search: CodeSearch) {
  const { code, section, spans, warnings } = selection(timeline, clip, options);
  const lines = options.lines ? readLines(code, options.lines) : undefined;
  const ranges = spans.map(span => spanLines(code, span)), rows = code.split('\n');
  let pattern: RegExp | undefined;
  try { if (search.regex) pattern = new RegExp(search.query, search.caseSensitive ? '' : 'i'); }
  catch { throw new Error('Invalid search regular expression. Use a JavaScript pattern without enclosing slashes.'); }
  const query = search.caseSensitive ? search.query : search.query.toLowerCase(), limit = search.limit ?? 50;
  const matches: { line: number; column: number; text: string; textStartColumn: number }[] = [];
  let nextStartLine: number | undefined;
  for (let index = Math.max(0, (search.startLine ?? 1) - 1); index < rows.length; index++) {
    const line = index + 1;
    if (lines && (line < lines.start || line > lines.end) || !ranges.some(range => line >= range.start && line <= range.end)) continue;
    const text = rows[index], column = pattern ? pattern.exec(text)?.index ?? -1 : (search.caseSensitive ? text : text.toLowerCase()).indexOf(query);
    if (column < 0) continue;
    if (matches.length === limit) { nextStartLine = line; break; }
    const from = Math.max(0, column - 160);
    matches.push({ line, column: column + 1, text: text.slice(from, column + 440), textStartColumn: from + 1 });
  }
  return { totalLines: rows.length, ...(lines ? { requestedLines: options.lines, lines, clamped: lines.start !== options.lines!.start || lines.end !== options.lines!.end } : {}), ...(section ? { section: section.label } : {}), search, matches, ...(nextStartLine ? { nextStartLine } : {}), warnings,
    note: 'One result per matching line, with its first matching column. Lines and columns are absolute and 1-based. Text is a bounded preview; use inspectClip lines for exact code before patching. Continue with search.startLine = nextStartLine when present.' };
}

/** New scoped calls preserve legacy snippet semantics, or replace nonoverlapping snapshot line ranges. */
export function patchSceneCode(timeline: Timeline, clip: Clip, edits: (SceneEdit | SceneLineEdit)[], options: Pick<CodeSelection, 'section'>) {
  const initial = selection(timeline, clip, options), warnings = new Set(initial.warnings);
  const warn = (code: string, spans: Span[]) => {
    const named = sections(timeline, { ...clip, scene: clip.scene ? { ...clip.scene, code } : undefined }, code);
    const touched = named.filter(section => section.spans.some(span => spans.some(edit => intersects(span, edit))));
    const covered = mergeSpans(named.flatMap(section => section.spans));
    if (touched.length > 1 || (named.length && spans.some(span => !covered.some(owner => contains(owner, span))))) warnings.add(`This edit touches shared code or section boundaries${touched.length ? ` (${touched.map(section => section.label).join(', ')})` : ''}. It can change a transition spanning sections. Keep its tween on the shared timeline and inspect frames on both sides of each affected boundary.`);
  };
  const lineEdits = edits.filter((edit): edit is SceneLineEdit => 'lines' in edit);
  if (lineEdits.length) {
    if (lineEdits.length !== edits.length) throw new Error('Use either line edits or find/replace edits in a call, not both. Nothing was changed.');
    const resolved = lineEdits.map(edit => ({ ...edit, span: lineSpan(initial.code, edit.lines) })).sort((a, b) => a.span.from - b.span.from);
    for (let index = 0; index < resolved.length; index++) {
      const edit = resolved[index];
      if (index && resolved[index - 1].lines.end >= edit.lines.start) throw new Error('Line edit ranges overlap. Use separate nonoverlapping ranges. Nothing was changed.');
      if (!initial.spans.some(span => contains(lineSpan(initial.code, spanLines(initial.code, span)), edit.span))) throw new Error('A line edit crosses this section\'s code blocks. Edit one returned block at a time, or omit section and pass scope covering the affected sections for shared transitions. Nothing was changed.');
    }
    warn(initial.code, resolved.map(edit => edit.span));
    const rows = initial.code.split('\n');
    for (const { lines, replace, insert } of resolved.reverse()) {
      const replacement = replace === '' ? [] : replace.split('\n');
      const count = lines.end - lines.start + 1;
      rows.splice(insert === 'after' ? lines.end : lines.start - 1, insert ? 0 : count, ...replacement);
    }
    return { code: rows.join('\n'), warnings: [...warnings] };
  }
  let code = initial.code;
  for (const [index, edit] of edits.entries()) {
    if (!('find' in edit)) continue;
    const currentClip = { ...clip, scene: clip.scene ? { ...clip.scene, code } : undefined };
    const current = selection(timeline, currentClip, options), matches = sceneSnippetMatches(code, edit.find, current.spans);
    if (!matches.length) throw new Error(`Edit ${index + 1}: the snippet was not found inside the selected code. Nothing was changed.${closestCodeLines(code, edit.find, 1, current.spans.map(span => spanLines(code, span)))}${index ? '\nLine numbers include preceding edits in this failed call. Inspect the saved code before retrying.' : ''}`);
    if (matches.length > 1 && !edit.all) throw new Error(`Edit ${index + 1}: the snippet appears ${matches.length} times inside the selected code. Add context or set all: true. Nothing was changed.`);
    if (matches.some((match, index) => index > 0 && matches[index - 1].to > match.from)) throw new Error(`Edit ${index + 1}: snippet matches overlap. Add context. Nothing was changed.`);
    warn(code, matches);
    for (const { from, to } of matches.reverse()) {
      const found = code.slice(from, to), replace = edit.insert === 'before' ? edit.replace + found : edit.insert === 'after' ? found + edit.replace : edit.replace;
      code = code.slice(0, from) + replace + code.slice(to);
    }
  }
  return { code, warnings: [...warnings] };
}

/** Three-way line merge: edits to changed lines or insertion boundaries are conflicts, never guesses. */
export function rebaseSceneCode(base: string, current: string, patched: string) {
  if (base === current) return patched;
  type Change = { start: number; end: number; rows: string[] };
  const changes = (next: string) => {
    const result: Change[] = [];
    let line = 0, change: Change | undefined;
    for (const part of diffArrays(base.split('\n'), next.split('\n'))) {
      if (!part.added && !part.removed) { line += part.value.length; change = undefined; continue; }
      if (!change) { change = { start: line, end: line, rows: [] }; result.push(change); }
      if (part.removed) { line += part.value.length; change.end = line; }
      else change.rows.push(...part.value);
    }
    return result;
  };
  const saved = changes(current), wanted = changes(patched), rows = current.split('\n'), baseRows = base.split('\n');
  const overlap = (a: Change, b: Change) => a.start === a.end || b.start === b.end ? a.start <= b.end && b.start <= a.end : a.start < b.end && b.start < a.end;
  for (const edit of wanted) {
    if (saved.some(change => overlap(edit, change))) throw new Error(`The inspected revision conflicts at original lines ${edit.start + 1}-${Math.max(edit.start + 1, edit.end)}. Those lines or their insertion boundary changed since inspection. Nothing was changed.${closestCodeLines(current, base.split('\n').slice(edit.start, Math.max(edit.start + 1, edit.end)).join('\n'))}`);
    // Repeated unchanged blocks can give a diff several equally valid alignments (for example deleting one of two identical lines).
    const start = Math.max(0, ...saved.filter(change => change.end <= edit.start).map(change => change.end));
    const end = Math.min(baseRows.length, ...saved.filter(change => change.start >= edit.end).map(change => change.start));
    const anchor = `\n${baseRows.slice(start, end).join('\n')}\n`;
    const unique = (code: string) => { const text = `\n${code}\n`, at = text.indexOf(anchor); return at >= 0 && text.indexOf(anchor, at + 1) < 0; };
    if (start === end || !unique(base) || !unique(current)) throw new Error(`The inspected revision has ambiguous unchanged code around original lines ${edit.start + 1}-${Math.max(edit.start + 1, edit.end)}. Read inspectClip again and patch the current revision. Nothing was changed.`);
  }
  for (const edit of wanted.reverse()) {
    const shift = saved.filter(change => change.end <= edit.start).reduce((sum, change) => sum + change.rows.length - (change.end - change.start), 0);
    rows.splice(edit.start + shift, edit.end - edit.start, ...edit.rows);
  }
  return rows.join('\n');
}
