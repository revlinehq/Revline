"use node";
import { v } from 'convex/values';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

// findIcon: a real brand logo or UI icon as SVG markup, so agents never redraw one by hand. Brand marks come from
// simple-icons (CC0, with the brand's hex) on jsDelivr and Iconify's logo sets; UI icons from permissively licensed
// Iconify sets. Only these two hosts are fetched. The preview sheet is drawn with resvg (its wasm from jsDelivr too).

const HOSTS = new Set(['cdn.jsdelivr.net', 'api.iconify.design']);
const SIMPLE_ICONS = 'https://cdn.jsdelivr.net/npm/simple-icons@16.36.0';
const RESVG_WASM = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.4.1/index_bg.wasm';
// Checked against api.iconify.design/collections: every set here is CC0, MIT, ISC or Apache-2.0.
const LICENSES: Record<string, { spdx: string; url: string }> = {
  'simple-icons': { spdx: 'CC0-1.0', url: 'https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md' },
  logos: { spdx: 'CC0-1.0', url: 'https://github.com/gilbarbara/logos/blob/main/LICENSE.txt' },
  'skill-icons': { spdx: 'MIT', url: 'https://github.com/tandpfun/skill-icons/blob/main/LICENSE' },
  devicon: { spdx: 'MIT', url: 'https://github.com/devicons/devicon/blob/master/LICENSE' },
  lucide: { spdx: 'ISC', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
  tabler: { spdx: 'MIT', url: 'https://github.com/tabler/tabler-icons/blob/master/LICENSE' },
  ph: { spdx: 'MIT', url: 'https://github.com/phosphor-icons/core/blob/main/LICENSE' },
  'material-symbols': { spdx: 'Apache-2.0', url: 'https://github.com/google/material-design-icons/blob/master/LICENSE' },
  heroicons: { spdx: 'MIT', url: 'https://github.com/tailwindlabs/heroicons/blob/master/LICENSE' },
  mdi: { spdx: 'Apache-2.0', url: 'https://github.com/Templarian/MaterialDesign/blob/master/LICENSE' },
  // The SVG artwork is Apache-2.0; Noto's font license is a separate OFL license.
  noto: { spdx: 'Apache-2.0', url: 'https://github.com/googlefonts/noto-emoji/blob/main/2D/svg/LICENSE' },
  'fluent-emoji': { spdx: 'MIT', url: 'https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE' },
};
const LOGO_SETS = ['logos', 'skill-icons', 'devicon'], UI_SETS = ['lucide', 'tabler', 'ph', 'material-symbols', 'heroicons', 'mdi'];
const EMOJI_SETS = ['noto', 'fluent-emoji'];
const allowedSets = () => Object.entries(LICENSES).map(([name, license]) => `${name} (${license.spdx})`).join(', ');
function validateIconId(id: string) {
  const [prefix, name, extra] = id.split(':');
  if (!Object.hasOwn(LICENSES, prefix)) throw new Error(`Icon set "${prefix}" is not supported by findIcon's license allow-list. Allowed sets: ${allowedSets()}.`);
  if (extra !== undefined || !/^[a-z0-9-]+$/.test(name ?? '')) throw new Error(`Invalid icon id "${id}". Use set:icon-name. Allowed sets: ${allowedSets()}.`);
}
const TRADEMARK = 'A trademark of its owner: show it as it is, to name that product. Never recolor, distort, restyle or combine it with other marks, and never imply endorsement.';
const MAX_SVG = 40_000;
/** Raise when results change shape or quality, so cached answers are fetched again. */
const CACHE_VERSION = 5;

type SimpleIcon = { title: string; slug: string; hex: string; source: string; guidelines?: string; license?: { type: string; url?: string }; aliases?: { aka?: string[]; dup?: { title: string }[]; loc?: Record<string, string>; old?: string[] } };
type Candidate = { id: string; title: string; kind: 'logo' | 'glyph' | 'ui' | 'emoji'; score: number; hex?: string; simple?: SimpleIcon };
type Style = 'logo' | 'glyph' | 'ui';

async function fetchFrom(url: string, as: 'text' | 'json') {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)) throw new Error(`Icons load only from ${[...HOSTS].join(' and ')}.`);
  const response = await fetch(target, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error(`${target.hostname} answered ${response.status}.`);
  return as === 'json' ? response.json() : response.text();
}

const words = (value: string) => value.toLowerCase().normalize('NFD').replace(/\+/g, 'plus').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
/** Brand identity requires a full normalized name or a declared alias. */
function match(query: string, name: string) {
  const a = words(query), b = words(name);
  if (!a || !b) return 0;
  return a === b ? 3 : 0;
}

let simpleIcons: Promise<SimpleIcon[]> | undefined;
function simpleIconData() {
  simpleIcons ??= (fetchFrom(`${SIMPLE_ICONS}/data/simple-icons.json`, 'json') as Promise<SimpleIcon[]>).catch(error => { simpleIcons = undefined; throw error; });
  return simpleIcons;
}

async function simpleCandidates(query: string): Promise<Candidate[]> {
  const icons = await simpleIconData();
  return icons.map(icon => {
    const names = [icon.title, icon.slug, ...(icon.aliases?.aka ?? []), ...(icon.aliases?.dup ?? []).map(dup => dup.title), ...Object.values(icon.aliases?.loc ?? {})];
    return { id: `simple-icons:${icon.slug}`, title: icon.title, kind: 'glyph' as const, score: Math.max(...names.map(name => match(query, name))), hex: `#${icon.hex}`, simple: icon };
  }).filter(candidate => candidate.score >= 2).sort((a, b) => b.score - a.score).slice(0, 4);
}

/** Iconify's own search, ranked for a brand: the name itself, then its symbol (-icon) variant, the newest dated redesign first. */
async function iconifyCandidates(query: string, sets: string[], kind: Candidate['kind']): Promise<Candidate[]> {
  const found = await fetchFrom(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefixes=${sets.join(',')}&limit=32`, 'json') as { icons?: string[] };
  return (found.icons ?? []).map((id, order) => {
    const [prefix, name] = id.split(':');
    const year = Number(name.match(/(?:19|20)\d\d/)?.[0] ?? 0);
    const base = name.replace(/-(icon|wordmark|light|dark|\d{4})$/g, '').replace(/^google-/, '');
    const score = kind === 'ui' || kind === 'emoji' ? 3 - order / 100 : match(query, base) + (name.endsWith('-icon') ? .3 : 0) + year / 1e5 - sets.indexOf(prefix) * .2 - (name.includes('wordmark') ? .4 : 0);
    return { id, title: name.replace(/-/g, ' '), kind, score };
  }).filter(candidate => candidate.score >= 1).sort((a, b) => b.score - a.score);
}

/** The icon's markup ready to inline: no fixed size, no title, nothing executable, the brand fill on a single-color mark. */
async function iconSvg(candidate: Candidate, color?: string) {
  const [prefix, name] = candidate.id.split(':');
  validateIconId(candidate.id);
  let svg = String(prefix === 'simple-icons' ? await fetchFrom(`${SIMPLE_ICONS}/icons/${name}.svg`, 'text') : await fetchFrom(`https://api.iconify.design/${prefix}/${name}.svg`, 'text'));
  if (!svg.trimStart().startsWith('<svg')) throw new Error(`${candidate.id} is not an icon.`);
  svg = svg.replace(/<script[\s\S]*?<\/script>|<foreignObject[\s\S]*?<\/foreignObject>|<title>[\s\S]*?<\/title>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, '').replace(/\s(?:xlink:)?href="(?!#)[^"]*"/gi, '').replace(/\s+/g, ' ').trim();
  svg = svg.replace(/^<svg([^>]*)>/, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height|role)="[^"]*"/g, '')}>`);
  const fill = color ?? (prefix === 'simple-icons' ? candidate.hex : undefined);
  if (fill) svg = svg.includes('currentColor') ? svg.replaceAll('currentColor', fill) : svg.replace(/^<svg/, `<svg fill="${fill}"`);
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24';
  const [, , width, height] = viewBox.split(/[\s,]+/).map(Number);
  const colors = [...new Set([...svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{3,8})"/g)].map(found => found[1].toLowerCase()))];
  // A shape with no fill anywhere above it draws in the default black.
  if (!/<(?:svg|g)\s[^>]*fill=/.test(svg) && /<(?:path|rect|circle|ellipse|polygon)(?![^>]*\sfill=)[\s/>]/.test(svg)) colors.push('#000000');
  return { svg, viewBox, aspect: Math.round(width / height * 1000) / 1000, colors, currentColor: svg.includes('currentColor') };
}

let rasterizer: Promise<unknown> | undefined;
const light = (hex: string) => { const value = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1, 7); const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)); return .2126 * r + .7152 * g + .0722 * b > 215; };
/** One PNG with the candidates side by side, the chosen one first, each on a tile it stands out against. */
async function previewSheet(icons: { svg: string; viewBox: string; colors: string[] }[]) {
  rasterizer ??= initWasm(fetch(RESVG_WASM)).catch(error => { rasterizer = undefined; throw error; });
  await rasterizer;
  const tile = 176, gap = 12, pad = 24;
  const body = icons.map((icon, index) => {
    const x = gap + index * (tile + gap), dark = icon.colors.length > 0 && icon.colors.every(light);
    const inner = icon.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replaceAll('currentColor', '#1c1c1e');
    const fill = icon.svg.match(/^<svg[^>]*\sfill="([^"]+)"/)?.[1];
    return `<rect x="${x}" y="${gap}" width="${tile}" height="${tile}" rx="14" fill="${dark ? '#2a2a2e' : '#f2f2f4'}"/><svg x="${x + pad}" y="${gap + pad}" width="${tile - 2 * pad}" height="${tile - 2 * pad}" viewBox="${icon.viewBox}"${fill ? ` fill="${fill}"` : ''}>${inner}</svg>`;
  }).join('');
  const width = gap + icons.length * (tile + gap), height = tile + 2 * gap;
  return Buffer.from(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`).render().asPng()).toString('base64');
}

export const find = internalAction({
  args: { name: v.string(), style: v.optional(v.union(v.literal('logo'), v.literal('glyph'), v.literal('ui'))), color: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const name = args.name.trim(), color = args.color?.trim();
    if (color && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) throw new Error('color must be a hex color like #1a1a1a.');
    const exact = name.includes(':') ? name : undefined;
    if (exact) validateIconId(exact);
    const style: Style = args.style ?? (exact && UI_SETS.includes(exact.split(':')[0]) ? 'ui' : exact && EMOJI_SETS.includes(exact.split(':')[0]) ? 'glyph' : 'logo');
    const key = `${CACHE_VERSION}|${style}|${color ?? ''}|${exact ?? words(name)}`;
    const cached = await ctx.runQuery(internal.iconCache.get, { key });
    if (cached) return cached;

    let candidates: Candidate[];
    if (exact) {
      const [prefix, slug] = exact.split(':');
      const simple = prefix === 'simple-icons' ? (await simpleIconData()).find(icon => icon.slug === slug) : undefined;
      candidates = [{ id: exact, title: simple?.title ?? slug.replace(/-/g, ' '), kind: prefix === 'simple-icons' ? 'glyph' : UI_SETS.includes(prefix) ? 'ui' : EMOJI_SETS.includes(prefix) ? 'emoji' : 'logo', score: 3, ...(simple ? { hex: `#${simple.hex}`, simple } : {}) }];
    } else if (style === 'ui') {
      candidates = await iconifyCandidates(name, UI_SETS, 'ui');
    } else {
      const [simple, logos, emoji] = await Promise.all([simpleCandidates(name).catch(() => []), iconifyCandidates(name, LOGO_SETS, 'logo').catch(() => []), style === 'glyph' ? iconifyCandidates(name, EMOJI_SETS, 'emoji').catch(() => []) : Promise.resolve([])]);
      // Programming packs use shorthand slugs (e.g. apollo for Apollo GraphQL),
      // which cannot establish a requested company's identity on their own.
      const identifiedLogos = logos.filter(candidate => simple.length > 0 || candidate.id.startsWith('logos:'));
      // A full-color logo leads for 'logo' when it is the same name; the brand's single-color mark leads for 'glyph'.
      const exactLogos = identifiedLogos.filter(candidate => candidate.score >= 2), rest = identifiedLogos.filter(candidate => candidate.score < 2);
      candidates = style === 'glyph' ? [...simple, ...emoji, ...exactLogos, ...rest] : [...exactLogos, ...simple, ...rest];
    }
    candidates = candidates.filter((candidate, index) => candidates.findIndex(other => other.id === candidate.id) === index).slice(0, 8);
    if (!candidates.length) {
      return { found: false, name, style, allowedSets: Object.keys(LICENSES), note: style === 'ui' ? 'No UI icon matched. Try a plainer word for the thing it shows (send, calendar, check, mic).' : style === 'glyph' ? 'No glyph or emoji matched. Try a plainer name or an exact id such as noto:trophy or fluent-emoji:trophy.' : `No logo for "${name}" in simple-icons or Iconify's logo sets. Do not draw it from memory. If the logo shows in a reference video or the user's media, traceShape it at a frame where it is whole and sharp (box tight around the mark): that outline is the real logo. Otherwise show the name as type in the brand's font and color. Never stop to ask the user for the logo file.` };
    }

    const fetched = await Promise.allSettled(candidates.slice(0, 4).map(async candidate => ({ candidate, ...await iconSvg(candidate, candidate.kind === 'emoji' ? undefined : color) })));
    const shown = fetched.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!shown.length) throw new Error(`Could not load ${candidates.slice(0, 4).map(candidate => candidate.id).join(', ')}: ${fetched.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []).join('; ')}`);
    const chosen = shown[0], prefix = chosen.candidate.id.split(':')[0], brand = chosen.candidate.kind === 'logo' || chosen.candidate.kind === 'glyph';
    const simple = chosen.candidate.simple;
    let images: { label: string; data: string; mimeType: string }[] = [];
    try { images = [{ label: `Preview, left to right: ${shown.map((icon, index) => `${index + 1} ${icon.candidate.id}${index === 0 ? ' (returned)' : ''}`).join(', ')}`, data: await previewSheet(shown), mimeType: 'image/png' }]; } catch { /* The markup is the result; a preview that cannot be drawn is left out. */ }
    const result = {
      found: true, id: chosen.candidate.id, title: chosen.candidate.title, kind: chosen.candidate.kind,
      ...(chosen.candidate.hex ? { brandColor: chosen.candidate.hex } : {}), colors: chosen.colors, viewBox: chosen.viewBox, aspect: chosen.aspect, bytes: chosen.svg.length,
      svg: chosen.svg.length <= MAX_SVG ? chosen.svg : undefined,
      source: simple?.source ?? `https://icon-sets.iconify.design/${prefix}/${chosen.candidate.id.split(':')[1]}/`,
      license: simple?.license ? { spdx: simple.license.type, ...(simple.license.url ? { url: simple.license.url } : {}) } : LICENSES[prefix],
      ...(simple?.guidelines ? { guidelines: simple.guidelines } : {}),
      ...(brand ? { trademark: TRADEMARK } : {}),
      alternatives: candidates.slice(1).map(candidate => ({ id: candidate.id, title: candidate.title, kind: candidate.kind })),
      note: [
        chosen.svg.length > MAX_SVG ? `This logo is ${chosen.svg.length} characters of markup, too large to inline; pick a simpler alternative (a -icon or simple-icons variant).` : 'Inline svg in the scene code as it is (for example const GMAIL = `<svg ...>`; then el.innerHTML = GMAIL, or <span dangerouslySetInnerHTML={{ __html: GMAIL }} /> in a React scene) and size it with CSS width and height on the svg, keeping its aspect.',
        chosen.currentColor ? 'It draws in currentColor: set CSS color on its parent.' : '',
        shown.length > 1 ? 'If the preview shows a better match (newer logo, symbol without wordmark), call findIcon again with that id as name.' : '',
      ].filter(Boolean).join(' '),
      images,
    };
    await ctx.runMutation(internal.iconCache.put, { key, value: JSON.stringify(result) });
    return result;
  },
});
