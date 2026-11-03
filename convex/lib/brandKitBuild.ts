import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { BRAND_LIMITS, isBrandColor, type BrandColor, type BrandCopy, type BrandFontRole, type SceneBrand } from '../../lib/editor/brand-kit';

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

/** The kit as a scene carries it: font files by public URL, no context or copy. */
export async function sceneBrandSnapshot(ctx: ActionCtx, ownerId: string, kitId: string): Promise<SceneBrand> {
  const kit = await ctx.runQuery(internal.brandKits.get, { ownerId, kitId });
  if (!kit) throw new Error('Brand kit not found. List kits with listBrandKits.');
  return { kitId: kit._id, name: kit.name, colors: kit.colors, fonts: kit.fonts.flatMap((font, index) => kit.fontUrls[index] ? [{ family: font.family, weight: font.weight, role: font.role, url: kit.fontUrls[index]! }] : []), ...(kit.logo ? { logo: kit.logo } : {}), ...(kit.screens?.length ? { screens: kit.screens.slice(0, BRAND_LIMITS.screens).map((screen, index) => ({ name: screen.name, url: kit.screenUrls[index] })) } : {}) };
}
