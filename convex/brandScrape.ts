"use node";
import { bytesToBase64 } from '../lib/encoding';

import { v } from 'convex/values';
import { internalAction, type ActionCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { BRAND_LIMITS, type BrandColor, type BrandCopy, type BrandFontRole } from '../lib/editor/brand-kit';
import { cleanSvg, emptyCssScan, firstSvg, pickColors, pickFaces, pickFonts, scanCss, scanPage, type CssScan } from '../lib/brand/scrape';
import { downloadPublicHttps } from '../lib/server/public-https';

/** Fetching a brand: the landing page, its CSS, its font files and logo. Font files go to storage. */
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
type FontRow = { family: string; weight: string; role: BrandFontRole; storageId: Id<'_storage'> };

async function get(url: string, referer?: string, limit = 3_000_000) {
  return downloadPublicHttps(url, { maxBytes: limit, headers: { 'user-agent': BROWSER, accept: '*/*', ...(referer ? { referer } : {}) } });
}
const text = (data: ArrayBuffer) => new TextDecoder().decode(data);

/** Google serves every script subset per weight; keep the latin ones. */
function latinOnly(css: string) {
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g)];
  return blocks.length ? blocks.filter(block => block[1] === 'latin').map(block => block[2]).join('\n') : css;
}

async function storeFaces(ctx: ActionCtx, scan: CssScan, picks: { family: string; role: BrandFontRole }[], referer?: string) {
  const fonts: FontRow[] = [], skipped: string[] = [];
  for (const pick of picks) for (const face of pickFaces(scan, pick.family)) {
    if (fonts.length >= BRAND_LIMITS.fonts) break;
    try {
      const file = await get(face.url, referer, BRAND_LIMITS.fontBytes);
      const type = /woff2/i.test(face.url) ? 'font/woff2' : /woff/i.test(face.url) ? 'font/woff' : /otf/i.test(face.url) ? 'font/otf' : 'font/ttf';
      fonts.push({ family: pick.family, weight: face.weight, role: pick.role, storageId: await ctx.storage.store(new Blob([file.data], { type })) });
    } catch { skipped.push(`${pick.family} ${face.weight}`); }
  }
  return { fonts, skipped };
}

/** Loads Google Fonts families by name, e.g. a theme the user describes. */
async function googleFonts(ctx: ActionCtx, families: { family: string; role: BrandFontRole }[]) {
  const scan: CssScan = emptyCssScan();
  const missing: string[] = [];
  for (const { family } of families) {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
    try { scanCss(latinOnly(text((await get(url)).data)), url, scan); }
    catch {
      try { const fallback = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`; scanCss(latinOnly(text((await get(fallback)).data)), fallback, scan); }
      catch { missing.push(family); }
    }
  }
  const stored = await storeFaces(ctx, scan, families.filter(item => !missing.includes(item.family)));
  return { fonts: stored.fonts, missing: [...missing, ...stored.skipped] };
}

async function logoFrom(urls: string[], referer: string) {
  for (const url of urls.slice(0, 6)) {
    try {
      const file = await get(url, referer, 400_000);
      if (/svg/i.test(file.type) || /\.svg(\?|$)/i.test(url)) { const svg = cleanSvg(firstSvg(text(file.data)) ?? ''); if (svg && svg.length <= BRAND_LIMITS.logo) return svg; continue; }
      const kind = file.type.match(/image\/(png|jpeg|webp)/i)?.[1]?.toLowerCase();
      const encoded = kind ? `data:image/${kind};base64,${bytesToBase64(new Uint8Array(file.data))}` : '';
      if (encoded && encoded.length <= BRAND_LIMITS.logo) return encoded;
    } catch { /* try the next candidate */ }
  }
}

type ScrapedBrand = { sourceUrl: string; colors: BrandColor[]; fonts: FontRow[]; logo?: string; copy: BrandCopy; notes: string[] };

async function scrapeBrand(ctx: ActionCtx, url: string): Promise<ScrapedBrand> {
  const page = await get(url);
  const html = text(page.data), base = page.url;
  const scan = scanPage(html, base);
  const css = scanCss(scan.inlineCss, base);
  const notes: string[] = [];
  for (const sheet of scan.stylesheets.slice(0, 10)) {
    try { const file = await get(sheet, base); scanCss(sheet.includes('fonts.googleapis.com') ? latinOnly(text(file.data)) : text(file.data), file.url, css); }
    catch { notes.push(`Could not read stylesheet ${sheet}.`); }
  }
  const picks = pickFonts(css);
  const stored = await storeFaces(ctx, css, picks, base);
  if (!picks.length) notes.push('No downloadable web fonts found; the site may use system fonts. Ask the user for the brand fonts (Google Fonts names work).');
  if (stored.skipped.length) notes.push(`Could not download: ${stored.skipped.join(', ')}.`);
  const logo = scan.logoSvg && scan.logoSvg.length <= BRAND_LIMITS.logo ? scan.logoSvg : await logoFrom(scan.logoUrls, base);
  if (!logo) notes.push('No logo found; ask the user for an SVG.');
  return { sourceUrl: base, colors: pickColors(css, scan.themeColor), fonts: stored.fonts, ...(logo ? { logo } : {}), copy: scan.copy, notes };
}


export const scrape = internalAction({ args: { url: v.string() }, returns: v.any(), handler: (ctx, { url }) => scrapeBrand(ctx, url) });
export const fonts = internalAction({ args: { families: v.array(v.object({ family: v.string(), role: v.union(v.literal('heading'), v.literal('body'), v.literal('other')) })) }, returns: v.any(), handler: (ctx, { families }) => googleFonts(ctx, families) });
