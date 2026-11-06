import type { Timeline } from '../../../editor/types';
import { SCENE_CONTRACT_LIMITS } from '../../../editor/scene-layers';

/**
 * Finish checks on saved film and scene code: deterministic, string-level, no rendering.
 * - Limits: code size per scene and per timeline (shared code counts once), clip and film length.
 * - Timing (original films only): literal `duration` on tl.to/from/fromTo. A non-camera move over 1 s fails,
 *   over 0.6 s warns. Camera targets mention "cam" (selector, variable, id) or carry data-camera.
 * - Exit vs entrance: warned only when one target has exactly one fade-in and one fade-out in the same section,
 *   both with literal durations; any other shape is skipped, because guessing a pair gives false alarms.
 * Hidden-but-visible elements are not checked here: that needs computed styles at render time.
 */
export type FilmCheckResult = { failures: string[]; warnings: string[] };

const MAX_MOVE = 1, SOFT_MOVE = .6;

/** Blank out strings, template literals and comments (same length), so code structure can be scanned safely. */
function maskCode(code: string) {
  const out = code.split('');
  let i = 0;
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { const end = code.indexOf('\n', i); const stop = end < 0 ? code.length : end; blank(i, stop); i = stop; continue; }
    if (c === '/' && n === '*') { const end = code.indexOf('*/', i + 2); const stop = end < 0 ? code.length : end + 2; blank(i, stop); i = stop; continue; }
    if (c === '/' && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof)\s*$/.test(code.slice(Math.max(0, i - 12), i))) {
      // A regex literal: skip to its closing slash, honoring escapes and character classes.
      let k = i + 1, inClass = false;
      while (k < code.length && code[k] !== '\n' && (inClass || code[k] !== '/')) { if (code[k] === '\\') k++; else if (code[k] === '[') inClass = true; else if (code[k] === ']') inClass = false; k++; }
      blank(i + 1, Math.min(k, code.length)); i = k + 1; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < code.length && code[k] !== c) k += code[k] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(k, code.length)); i = k + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** Index of the parenthesis closing the one at `open`, in masked code. */
function closing(masked: string, open: number) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level argument ranges of the call whose parenthesis opens at `open`. */
function argRanges(masked: string, open: number, close: number) {
  const ranges: [number, number][] = [];
  let depth = 0, from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { ranges.push([from, i]); from = i + 1; }
  }
  ranges.push([from, close]);
  return ranges;
}

/** A top-level `key: value` of an object literal argument, as raw text, or undefined. */
function topLevelValue(code: string, masked: string, [from, to]: [number, number], key: string) {
  const start = masked.indexOf('{', from);
  if (start < 0 || start >= to) return undefined;
  let depth = 0;
  for (let i = start; i < to; i++) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth !== 1) continue;
    const match = new RegExp(`^${key}\\s*:\\s*`).exec(masked.slice(i, to));
    if (match && /[\s,{]/.test(masked[i - 1] ?? ' ')) {
      const valueStart = i + match[0].length;
      let k = valueStart, d = 0;
      while (k < to && !(d === 0 && (masked[k] === ',' || masked[k] === '}'))) { if ('([{'.includes(masked[k])) d++; if (')]}'.includes(masked[k])) d--; k++; }
      return code.slice(valueStart, k).trim();
    }
  }
  return undefined;
}

const literalSeconds = (value?: string) => value !== undefined && /^\d*\.?\d+$/.test(value) ? Number(value) : undefined;
const hidesTo = (code: string, masked: string, range: [number, number]) => ['opacity', 'autoAlpha'].some(key => literalSeconds(topLevelValue(code, masked, range, key)) === 0);

type Move = { kind: 'to' | 'from' | 'fromTo'; target: string; seconds?: number; line: number; section: string; entrance: boolean; exit: boolean };

function moves(code: string): Move[] {
  const masked = maskCode(code);
  const lineAt = (index: number) => code.slice(0, index).split('\n').length;
  const sections: { name: string; from: number; to: number }[] = [];
  for (const match of masked.matchAll(/\bsection\s*\(/g)) {
    const open = match.index! + match[0].length - 1, close = closing(masked, open);
    if (close < 0) continue;
    const [first] = argRanges(masked, open, close);
    sections.push({ name: code.slice(first[0], first[1]).trim().replace(/^['"`]|['"`]$/g, ''), from: open, to: close });
  }
  const sectionAt = (index: number) => sections.filter(section => section.from < index && index < section.to).at(-1)?.name ?? 'outer timeline';
  const result: Move[] = [];
  for (const match of masked.matchAll(/\.(fromTo|from|to)\s*\(/g)) {
    const kind = match[1] as Move['kind'], open = match.index! + match[0].length - 1, close = closing(masked, open);
    if (close < 0 || /\bArray\s*$/.test(masked.slice(Math.max(0, match.index! - 8), match.index!))) continue;
    const args = argRanges(masked, open, close), vars = args[kind === 'fromTo' ? 2 : 1];
    if (!vars) continue;
    const seconds = literalSeconds(topLevelValue(code, masked, vars, 'duration'));
    result.push({
      kind, target: code.slice(args[0][0], args[0][1]).trim(), seconds, line: lineAt(match.index!), section: sectionAt(match.index!),
      entrance: kind === 'from' ? hidesTo(code, masked, vars) : kind === 'fromTo' && hidesTo(code, masked, args[1]),
      exit: kind === 'to' && hidesTo(code, masked, vars),
    });
  }
  return result;
}

/** Names that point at camera elements: ids and classes of tags marked data-camera, and variables built from them. */
function cameraNames(code: string) {
  const names = new Set<string>();
  for (const tag of code.matchAll(/<[^>]*\bdata-camera\b[^>]*>/g)) {
    const id = /\bid\s*=\s*["']([^"']+)["']/.exec(tag[0])?.[1];
    if (id) names.add(`#${id}`);
    for (const name of /\bclass\s*=\s*["']([^"']+)["']/.exec(tag[0])?.[1].split(/\s+/) ?? []) if (name) names.add(`.${name}`);
  }
  for (const assignment of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g))
    if (/data-camera/.test(assignment[2]) || [...names].some(name => assignment[2].includes(name))) names.add(assignment[1]);
  return names;
}

function isCamera(target: string, names: Set<string>) {
  return /cam/i.test(target) || /data-camera/.test(target) || [...names].some(name => /^[A-Za-z_$]/.test(name) ? new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(target) : target.includes(name));
}

const short = (target: string) => target.length > 40 ? `${target.slice(0, 37)}...` : target;

function timingCheck(code: string, title: string, result: FilmCheckResult) {
  const names = cameraNames(code), all = moves(code);
  for (const move of all) {
    if (move.seconds === undefined || isCamera(move.target, names)) continue;
    const where = `${title}, section "${move.section}", line ${move.line}: ${move.kind}(${short(move.target)}) runs ${move.seconds} s`;
    if (move.seconds > MAX_MOVE) result.failures.push(`${where}; a non-camera move may run at most ${MAX_MOVE} s. Speed it up or split it (camera targets mention "cam" or carry data-camera).`);
    else if (move.seconds > SOFT_MOVE) result.warnings.push(`${where}; non-camera moves over ${SOFT_MOVE} s need a reason (a progress bar, a long draw-on).`);
  }
  const groups = new Map<string, Move[]>();
  for (const move of all) if (move.entrance || move.exit) groups.set(`${move.section}\u0000${move.target}`, [...groups.get(`${move.section}\u0000${move.target}`) ?? [], move]);
  for (const group of groups.values()) {
    const entrances = group.filter(move => move.entrance), exits = group.filter(move => move.exit);
    if (entrances.length !== 1 || exits.length !== 1) continue;
    const [entrance] = entrances, [exit] = exits;
    if (entrance.seconds === undefined || exit.seconds === undefined || exit.line < entrance.line) continue;
    if (exit.seconds >= entrance.seconds) result.warnings.push(`${title}, section "${entrance.section}", line ${exit.line}: the exit of ${short(exit.target)} (${exit.seconds} s) is not shorter than its entrance on line ${entrance.line} (${entrance.seconds} s); exits run about 0.8× the entrance.`);
  }
}

export function filmChecks(timeline: Timeline, options: { timing: boolean }): FilmCheckResult {
  const result: FilmCheckResult = { failures: [], warnings: [] };
  const scenes = timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene);
  const seen = new Set<string>();
  let total = 0;
  for (const clip of scenes) {
    const scene = clip.scene!, title = `"${scene.title}"`;
    if (scene.film) {
      if (scene.film.duration > SCENE_CONTRACT_LIMITS.filmSeconds) result.failures.push(`${title}: the film runs ${scene.film.duration} s; films may run at most ${SCENE_CONTRACT_LIMITS.filmSeconds} s. Shorten it or split it into two films.`);
    } else if (clip.duration > SCENE_CONTRACT_LIMITS.sceneSeconds) result.failures.push(`${title}: the scene clip runs ${Math.round(clip.duration * 100) / 100} s; scene clips may run at most ${SCENE_CONTRACT_LIMITS.sceneSeconds} s. Shorten it or build a film with addFilm.`);
    if (seen.has(scene.code)) continue;
    seen.add(scene.code);
    total += scene.code.length;
    if (scene.code.length > SCENE_CONTRACT_LIMITS.sceneCode) result.failures.push(`${title}: the code is ${scene.code.length.toLocaleString('en-US')} characters; one scene may hold at most ${SCENE_CONTRACT_LIMITS.sceneCode.toLocaleString('en-US')}. Move repeated markup into a loop or a blueprint.`);
    if (options.timing && !scene.film?.referenceAssetId) timingCheck(scene.code, title, result);
  }
  if (total > SCENE_CONTRACT_LIMITS.timelineCode) result.failures.push(`The timeline's scene code totals ${total.toLocaleString('en-US')} characters; it may hold at most ${SCENE_CONTRACT_LIMITS.timelineCode.toLocaleString('en-US')} (shared code counts once). Reuse code across clips or trim unused sections.`);
  return { failures: [...new Set(result.failures)], warnings: [...new Set(result.warnings)] };
}
