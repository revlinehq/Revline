import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { BRAND_LIMITS, isBrandColor, type BrandColor, type BrandCopy, type BrandFontRole } from '../../lib/editor/brand-kit';

export async function scrapeBrand(ctx: ActionCtx, url: string): Promise<{ sourceUrl: string; colors: BrandColor[]; fonts: { family: string; weight: string; role: BrandFontRole; storageId: Id<'_storage'> }[]; logo?: string; copy: BrandCopy; notes: string[] }> {
  return ctx.runAction(internal.brandScrape.scrape, { url });
}
export async function googleFonts(ctx: ActionCtx, families: { family: string; role: BrandFontRole }[]): Promise<{ fonts: { family: string; weight: string; role: BrandFontRole; storageId: Id<'_storage'> }[]; missing: string[] }> {
  return ctx.runAction(internal.brandScrape.fonts, { families });
}

export function cleanColors(colors: BrandColor[]) {
  const bad = colors.filter(color => !isBrandColor(color.value));
  if (bad.length) throw new Error(`Not CSS colors: ${bad.map(color => color.value).join(', ')}.`);
  return colors.slice(0, BRAND_LIMITS.colors).map(color => ({ name: color.name.trim().slice(0, 40), value: color.value.trim() }));
}

