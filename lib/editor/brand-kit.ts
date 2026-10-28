/** A user's saved brand: what a launch film looks like (colors, fonts, logo) and what it says (context). */
export type BrandColor = { name: string; value: string };
export type BrandFontRole = 'heading' | 'body' | 'other';
export type BrandFontFace = { family: string; weight: string; role: BrandFontRole; url: string };
export type BrandContext = { product?: string; problem?: string; audience?: string; features?: string[]; cta?: string; tone?: string; notes?: string };
export type BrandCopy = { title?: string; description?: string; headings: string[] };

/** The part of a kit a scene carries with it, so preview and export never look the kit up. */
export type SceneBrand = { kitId: string; name: string; colors: BrandColor[]; fonts: BrandFontFace[]; logo?: string };

export const BRAND_LIMITS = { name: 60, colors: 16, colorValue: 80, fonts: 8, fontBytes: 600_000, logo: 24_000, contextText: 600, features: 8, headings: 12 } as const;

/** What a scene receives as `brand`: named colors, a family per role, and the logo ready for <img> and as inline SVG. */
export type SceneBrandContext = {
  name: string;
  colors: Record<string, string>;
  palette: string[];
  fonts: Partial<Record<BrandFontRole, string>> & { families: string[] };
  logo: string | null;
  logoSvg: string | null;
};

const colorPattern = /^(#[\da-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^;{}<>]{1,70}\))$/i;

export function validateSceneBrand(brand: SceneBrand) {
  if (!brand.kitId || !brand.name || brand.name.length > BRAND_LIMITS.name) throw new Error('A scene brand needs its kit id and name.');
  if (brand.colors.length > BRAND_LIMITS.colors || brand.colors.some(color => !colorPattern.test(color.value) || !color.name || color.name.length > 40)) throw new Error('Scene brand colors are invalid.');
  if (brand.fonts.length > BRAND_LIMITS.fonts || brand.fonts.some(font => !/^https:\/\//.test(font.url) || !font.family || font.family.length > 80 || !/^[\d ]{1,9}$/.test(font.weight))) throw new Error('Scene brand fonts are invalid.');
  if (brand.logo !== undefined && (brand.logo.length > BRAND_LIMITS.logo || !(brand.logo.startsWith('<svg') || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(brand.logo)))) throw new Error('Scene brand logo is invalid.');
}

export function isBrandColor(value: string) { return colorPattern.test(value.trim()); }

function base64(text: string) {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Built inside the scene frame from the clip's snapshot. */
export function sceneBrandContext(brand: SceneBrand | undefined): SceneBrandContext | null {
  if (!brand) return null;
  const colors = Object.fromEntries(brand.colors.map(color => [color.name, color.value]));
  const families = [...new Set(brand.fonts.map(font => font.family))];
  const role = (wanted: BrandFontRole) => brand.fonts.find(font => font.role === wanted)?.family;
  const heading = role('heading') ?? role('body') ?? families[0], body = role('body') ?? heading;
  const svg = brand.logo?.startsWith('<svg') ? brand.logo : null;
  return {
    name: brand.name, colors, palette: brand.colors.map(color => color.value),
    fonts: { ...(heading ? { heading } : {}), ...(body ? { body } : {}), families },
    logo: svg ? `data:image/svg+xml;base64,${base64(svg)}` : brand.logo ?? null, logoSvg: svg,
  };
}
