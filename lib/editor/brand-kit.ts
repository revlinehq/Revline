/** A user's saved brand: its look (colors, fonts, logo) and what it says (context). */
export type BrandColor = { name: string; value: string };
export type BrandFontRole = 'heading' | 'body' | 'other';
export type BrandFontFace = { family: string; weight: string; role: BrandFontRole; url: string };
export type BrandCopy = { title?: string; description?: string; headings: string[] };

/** A product screenshot saved with the kit, named the way scenes read it from `media`. */
export type BrandScreen = { name: string; url: string };
/** The part of a kit a scene carries with it, so preview and export never look the kit up. */
export type SceneBrand = { kitId: string; name: string; colors: BrandColor[]; fonts: BrandFontFace[]; logo?: string; screens?: BrandScreen[] };

export const BRAND_LIMITS = { screens: 8, screenBytes: 8_000_000, name: 60, colors: 16, colorValue: 80, fonts: 8, fontBytes: 600_000, logo: 24_000, contextText: 2000, headings: 12 } as const;


const colorPattern = /^(#[\da-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^;{}<>]{1,70}\))$/i;


export function isBrandColor(value: string) { return colorPattern.test(value.trim()); }

/** Inline SVG copied from a page often lacks xmlns; as an image file it then renders nothing. */
export function standaloneSvg(svg: string) { return /^<svg\b[^>]*\sxmlns=/i.test(svg) ? svg : svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'); }

