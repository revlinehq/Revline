import { BRAND_LIMITS, isBrandColor, type BrandColor, type BrandCopy, type BrandFontRole } from '../editor/brand-kit';

/** Reads a landing page's HTML and CSS into brand candidates. Pure: the caller fetches. */
export type FontFaceCandidate = { family: string; weight: string; url: string; latin: boolean };
export type PageScan = { copy: BrandCopy; themeColor?: string; stylesheets: string[]; inlineCss: string; logoSvg?: string; logoUrls: string[]; googleFontCss: string[] };

const decode = (text: string) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find(value => value !== undefined);
const meta = (html: string, key: string) => { for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) if ((attr(tag, 'name') ?? attr(tag, 'property'))?.toLowerCase() === key) return attr(tag, 'content'); };
const absolute = (href: string, base: string) => { try { return new URL(decode(href), base).href; } catch { return undefined; } };

/** Removes anything executable or external from an inline SVG and lets the scene size it. */
export function cleanSvg(svg: string) {
  return svg.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '').replace(/<svg\b([^>]*)>/i, (_, attrs: string) => `<svg${attrs.replace(/\s(width|height|class|style)\s*=\s*("[^"]*"|'[^']*')/gi, '')}>`)
    .replace(/\s+/g, ' ').trim();
}

export function scanPage(html: string, baseUrl: string): PageScan {
  const title = meta(html, 'og:title') ?? textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(match => textOf(match[2])).filter(text => text.length > 2 && text.length < 160);
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const stylesheets = links.filter(tag => /stylesheet/i.test(attr(tag, 'rel') ?? '')).map(tag => absolute(attr(tag, 'href') ?? '', baseUrl)).filter((url): url is string => !!url);
  const googleFontCss = stylesheets.filter(url => url.includes('fonts.googleapis.com'));
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
  // The logo is usually the first SVG in the header or nav, or in a link home.
  const regions = [...html.matchAll(/<(header|nav)\b[\s\S]*?<\/\1>/gi)].map(match => match[0]);
  const homeLinks = [...html.matchAll(/<a\b[^>]*href=["'](?:\/|\.\/|https?:\/\/[^"']*\/?)["'][^>]*>[\s\S]*?<\/a>/gi)].map(match => match[0]);
  const svg = [...regions, ...homeLinks].map(block => block.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0]).find(found => found && found.length > 120 && found.length < BRAND_LIMITS.logo * 2);
  const images = (html.match(/<img\b[^>]*>/gi) ?? []).filter(tag => /logo|brand/i.test(`${attr(tag, 'src')} ${attr(tag, 'alt')} ${attr(tag, 'class')}`));
  const icons = links.filter(tag => /icon/i.test(attr(tag, 'rel') ?? '')).sort((a, b) => Number(/svg/i.test(attr(b, 'type') ?? attr(b, 'href') ?? '')) - Number(/svg/i.test(attr(a, 'type') ?? attr(a, 'href') ?? '')) || Number(/apple/i.test(attr(b, 'rel') ?? '')) - Number(/apple/i.test(attr(a, 'rel') ?? '')));
  const logoUrls = [...images.map(tag => attr(tag, 'src')), ...icons.map(tag => attr(tag, 'href'))].map(href => href && absolute(href, baseUrl)).filter((url): url is string => !!url && !url.startsWith('data:'));
  const themeColor = meta(html, 'theme-color');
  return { copy: { ...(title ? { title: title.slice(0, 160) } : {}), ...(description ? { description: decode(description).slice(0, 400) } : {}), headings: [...new Set(headings)].slice(0, BRAND_LIMITS.headings) }, ...(themeColor && isBrandColor(themeColor) ? { themeColor } : {}), stylesheets, inlineCss, ...(svg ? { logoSvg: cleanSvg(svg) } : {}), logoUrls: [...new Set(logoUrls)], googleFontCss };
}

/** next/font and similar tools hash family names (`__Inter_d65c78`); scenes use the readable name. */
export function readableFamily(family: string) {
  const name = family.trim().replace(/^["']|["']$/g, '');
  const hashed = name.match(/^__(.+?)_[\da-f]{5,}$/i);
  return (hashed ? hashed[1].replace(/_/g, ' ') : name).trim();
}

function firstFamily(value: string) { return value.split(',')[0]?.trim().replace(/^["']|["']$/g, ''); }
const genericFamilies = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|inherit|initial|unset|var\(.*|-apple-system|blinkmacsystemfont|arial|helvetica|helvetica neue|segoe ui|roboto fallback)$/i;

/** Font uses keep their raw value: sites often set fonts through variables defined in another file. */
export type CssScan = { faces: FontFaceCandidate[]; fontUses: { value: string; heading: boolean }[]; vars: Map<string, string>; colors: Map<string, number>; namedColors: BrandColor[] };
export const emptyCssScan = (): CssScan => ({ faces: [], fontUses: [], vars: new Map(), colors: new Map(), namedColors: [] });

export function scanCss(css: string, cssUrl: string, into: CssScan = emptyCssScan()): CssScan {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const body = match[1], family = body.match(/font-family\s*:\s*([^;]+)/i)?.[1];
    const sources = [...(body.match(/src\s*:\s*([^;]+)/i)?.[1] ?? '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)\s*(?:format\(\s*["']?([\w-]+)["']?\s*\))?/gi)];
    const best = sources.find(source => /woff2/i.test(source[2] ?? source[1])) ?? sources.find(source => /woff|truetype|opentype|\.ttf|\.otf/i.test(source[2] ?? source[1]));
    const url = best && absolute(best[1], cssUrl);
    if (family && url && !/fallback/i.test(family)) into.faces.push({ family: readableFamily(family), latin: !/unicode-range/i.test(body) || /U\+0+-0*FF\b|U\+0+(?:20)?-/i.test(body), weight: (body.match(/font-weight\s*:\s*([^;]+)/i)?.[1] ?? '400').trim().replace(/normal/i, '400').replace(/bold/i, '700'), url });
  }
  for (const rule of clean.matchAll(/([^{}@]+){([^{}]*)}/g)) {
    const selector = rule[1], body = rule[2];
    for (const declaration of body.matchAll(/(?:^|;)\s*(--[\w-]+)\s*:\s*([^;]+)/g)) if (!into.vars.has(declaration[1])) into.vars.set(declaration[1], declaration[2].trim());
    for (const declaration of body.matchAll(/(?:^|;)\s*(font-family|font|--[\w-]*(?:font|head|body|display|sans|serif)[\w-]*)\s*:\s*([^;]+)/gi)) {
      const value = declaration[1].toLowerCase() === 'font' ? declaration[2].replace(/^.*?\d[\w.%/ ]*\s+(?=["'\w-]+(?:,|$)|var\()/, '') : declaration[2];
      into.fontUses.push({ value: value.trim(), heading: /\bh[1-3]\b|head|title|display|hero/i.test(`${selector} ${declaration[1]} ${value}`) });
    }
    for (const declaration of body.matchAll(/(?:^|;)\s*(--[\w-]+|color|background|background-color|fill|stroke|border-color)\s*:\s*([^;]+)/gi)) {
      const property = declaration[1].toLowerCase(), value = declaration[2].trim().replace(/\s*!important$/, '');
      const color = value.match(/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\([^)]{3,60}\)/i)?.[0];
      if (!color || !isBrandColor(color) || translucent(color)) continue;
      const normal = normalizeColor(color);
      into.colors.set(normal, (into.colors.get(normal) ?? 0) + 1);
      // Design-token names say what a color is for; numbered palettes (--color-red-500) do not.
      if (property.startsWith('--') && /(primary|brand|accent|background|foreground|surface|muted|secondary|highlight|text)(?![\w-]*\d{2,})/i.test(property) && value === color && into.namedColors.length < 24 && !into.namedColors.some(named => named.name === property.replace(/^--(color-)?/, ''))) into.namedColors.push({ name: property.replace(/^--(color-)?/, ''), value: normal });
    }
  }
  return into;
}

/** Shadows and overlays are not brand colors. */
function translucent(color: string) {
  const hex = color.match(/^#([\da-f]{4}|[\da-f]{8})$/i)?.[1];
  if (hex) return !/^f+$/i.test(hex.length === 4 ? hex[3] : hex.slice(6));
  const alpha = color.match(/(?:\/|,)\s*([\d.]+%?)\s*\)$/)?.[1];
  return alpha !== undefined && (alpha.endsWith('%') ? Number.parseFloat(alpha) < 100 : Number(alpha) < 1);
}

export function normalizeColor(color: string) {
  const hex = color.trim().toLowerCase();
  if (/^#[\da-f]{3}$/.test(hex)) return `#${hex.slice(1).split('').map(c => c + c).join('')}`;
  return hex.replace(/\s+/g, ' ');
}

/** Ranks the page's families: the most used is body, the one headings use (if different) is heading. */
/** Follows var(--x, fallback) chains to the family a declaration really uses. */
function resolveFamily(value: string, vars: Map<string, string>) {
  for (let depth = 0; depth < 6; depth++) {
    const ref = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)/);
    if (!ref) break;
    value = vars.get(ref[1]) ?? ref[2] ?? '';
  }
  const family = firstFamily(value);
  return family && !genericFamilies.test(family) ? readableFamily(family) : undefined;
}

function fontUsage(scan: CssScan) {
  const usage = new Map<string, { count: number; heading: number }>();
  for (const use of scan.fontUses) {
    const family = resolveFamily(use.value, scan.vars);
    if (!family) continue;
    const entry = usage.get(family) ?? { count: 0, heading: 0 };
    entry.count++; if (use.heading) entry.heading++;
    usage.set(family, entry);
  }
  return usage;
}

export function pickFonts(scan: CssScan): { family: string; role: BrandFontRole }[] {
  const available = new Set(scan.faces.map(face => face.family));
  const ranked = [...fontUsage(scan).entries()].filter(([family]) => available.has(family)).sort((a, b) => b[1].count - a[1].count);
  const body = ranked[0]?.[0] ?? scan.faces[0]?.family;
  if (!body) return [];
  const heading = [...ranked].sort((a, b) => b[1].heading - a[1].heading)[0];
  const picks: { family: string; role: BrandFontRole }[] = [{ family: body, role: 'body' }];
  if (heading && heading[0] !== body && heading[1].heading > 0) picks.push({ family: heading[0], role: 'heading' });
  const extra = ranked.find(([family]) => !picks.some(pick => pick.family === family));
  if (extra) picks.push({ family: extra[0], role: 'other' });
  return picks;
}

/** Keeps up to four weights per family, closest to regular, medium, semibold and bold. */
export function pickFaces(scan: CssScan, family: string) {
  const faces = scan.faces.filter(face => face.family === family);
  // Split fonts ship one file per script; the Latin file must win for each weight.
  const unique = [...new Map([...faces].sort((a, b) => Number(a.latin) - Number(b.latin)).map(face => [face.weight, face])).values()];
  const score = (weight: string) => Math.min(...[400, 500, 600, 700].map(target => Math.abs((Number.parseInt(weight) || 400) - target)));
  return unique.sort((a, b) => score(a.weight) - score(b.weight)).slice(0, 4);
}

/** Named design tokens first, then the most used literal colors, skipping near-duplicates. */
export function pickColors(scan: CssScan, themeColor?: string): BrandColor[] {
  const picked: BrandColor[] = [], seen = new Set<string>();
  const add = (name: string, value: string) => { if (seen.has(value) || picked.length >= 12) return; seen.add(value); picked.push({ name, value }); };
  if (themeColor) add('theme', normalizeColor(themeColor));
  for (const color of scan.namedColors) add(color.name, color.value);
  let index = 1;
  for (const [value] of [...scan.colors.entries()].sort((a, b) => b[1] - a[1])) add(`color-${index++}`, value);
  return picked;
}
