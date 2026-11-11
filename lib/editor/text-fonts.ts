/** The one list of text fonts. The editor preview, the frame and export renderer (`composition.ts`,
 *  `prepare-composition.ts`), the Convex clip schema, the assistant/MCP `fontFamily` argument and
 *  discoverCapabilities all read it; a font added here is available everywhere text is drawn.
 *  `extraFaces`: more static files of the same family (other weights). `legacy`: a font added after the deployed
 *  media processor was built names the older font it draws with until that processor is released
 *  (`legacyRenderTimeline`, guarded by `processorCan(ctx, 'render:fonts-2')`). */
export const TEXT_FONTS = [
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', fileName: 'space-grotesk-latin.woff2', weight: 700, faceWeight: '300 700' },
  { id: 'anton', label: 'Anton', family: 'Anton', fileName: 'anton.ttf', weight: 400, faceWeight: '400' },
  { id: 'dm-serif', label: 'DM Serif Display', family: 'DM Serif Display', fileName: 'dm-serif.ttf', weight: 400, faceWeight: '400' },
  { id: 'geist-mono', label: 'Geist Mono', family: 'Geist Mono', fileName: 'geist-mono-latin.woff2', weight: 700, faceWeight: '100 900' },
  { id: 'inter', label: 'Inter', family: 'Inter', fileName: 'inter.ttf', weight: 700, faceWeight: '100 900' },
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans', fileName: 'dm-sans.ttf', weight: 700, faceWeight: '100 1000' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', fileName: 'montserrat.ttf', weight: 700, faceWeight: '100 900' },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', fileName: 'poppins.ttf', weight: 700, faceWeight: '700', extraFaces: [
    { fileName: 'poppins-regular.ttf', faceWeight: '400' }, { fileName: 'poppins-semibold.ttf', faceWeight: '600' },
    { fileName: 'poppins-extrabold.ttf', faceWeight: '800' }, { fileName: 'poppins-black.ttf', faceWeight: '900' },
  ] },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', fileName: 'oswald.ttf', weight: 700, faceWeight: '200 700' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: 'Bebas Neue', fileName: 'bebas-neue.ttf', weight: 400, faceWeight: '400' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', fileName: 'playfair-display.ttf', weight: 700, faceWeight: '400 900' },
  { id: 'caveat', label: 'Caveat', family: 'Caveat', fileName: 'caveat.ttf', weight: 700, faceWeight: '400 700' },
  { id: 'tiktok-sans', label: 'TikTok Sans', family: 'TikTok Sans', fileName: 'tiktok-sans.ttf', weight: 700, faceWeight: '300 900' },
  { id: 'barlow-condensed', label: 'Barlow Condensed', family: 'Barlow Condensed', fileName: 'barlow-condensed.ttf', weight: 700, faceWeight: '700' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: 'IBM Plex Mono', fileName: 'ibm-plex-mono.ttf', weight: 500, faceWeight: '500' },
  { id: 'lora', label: 'Lora', family: 'Lora', fileName: 'lora.ttf', weight: 600, faceWeight: '400 700' },
  { id: 'archivo-black', label: 'Archivo Black', family: 'Archivo Black', fileName: 'archivo-black.ttf', weight: 400, faceWeight: '400' },
  { id: 'fraunces', label: 'Fraunces', family: 'Fraunces', fileName: 'fraunces.ttf', weight: 700, faceWeight: '100 900' },
  { id: 'bangers', label: 'Bangers', family: 'Bangers', fileName: 'bangers.ttf', weight: 400, faceWeight: '400', legacy: 'anton' },
  { id: 'outfit', label: 'Outfit', family: 'Outfit', fileName: 'outfit.ttf', weight: 700, faceWeight: '100 900', legacy: 'dm-sans' },
  { id: 'rubik', label: 'Rubik', family: 'Rubik', fileName: 'rubik.ttf', weight: 700, faceWeight: '300 900', legacy: 'montserrat' },
  { id: 'figtree', label: 'Figtree', family: 'Figtree', fileName: 'figtree.ttf', weight: 700, faceWeight: '300 900', legacy: 'montserrat' },
] as const;
export type TextFontId = typeof TEXT_FONTS[number]['id'];
type TextFontEntry = { id: TextFontId; label: string; family: string; fileName: string; weight: number; faceWeight: string; extraFaces?: readonly { fileName: string; faceWeight: string }[]; legacy?: TextFontId };
const FONTS: readonly TextFontEntry[] = TEXT_FONTS;

/** New captions and text graphics are written with this font; captions and titles use its bold (700) weight. */
export const DEFAULT_TEXT_FONT: TextFontId = 'montserrat';
/** What a clip saved without a font draws with. Existing text keeps it, so it is not the new default. */
export const UNSET_TEXT_FONT: TextFontId = 'space-grotesk';

export function textFont(id?: TextFontId): TextFontEntry { return FONTS.find(font => font.id === id) ?? FONTS[0]; }
/** Every face of a font: its main file and any further static weights. */
export function textFontFaces(font: TextFontEntry) { return [{ fileName: font.fileName, faceWeight: font.faceWeight }, ...(font.extraFaces ?? [])]; }
/** Resolve to a weight actually bundled for this family: the nearest weight one of its faces covers. */
export function textFontWeight(id: TextFontId | undefined, requested?: number) {
  const font = textFont(id), wanted = Number.isFinite(requested) ? requested! : font.weight;
  let best = font.weight, distance = Infinity;
  for (const face of textFontFaces(font)) {
    const range = face.faceWeight.split(' ').map(Number), weight = Math.max(range[0], Math.min(range.at(-1)!, wanted));
    if (Math.abs(weight - wanted) < distance) { best = weight; distance = Math.abs(weight - wanted); }
  }
  return best;
}
/** Parent-document text faces must never override Next's application fonts. */
export function editorTextFont(id?: TextFontId) {
  const font = textFont(id);
  return { ...font, family: `Revline Text ${font.id}` };
}
export function isTextFont(value: unknown): value is TextFontId { return FONTS.some(font => font.id === value); }
/** The font an older media processor draws instead of one added after it was built; undefined when it has this one. */
export function legacyTextFont(id: TextFontId | undefined): TextFontId | undefined { return id === undefined ? undefined : textFont(id).legacy; }
/** Colour emoji for every text font (Noto Color Emoji, COLRv1, OFL). None of the text fonts has emoji, and a render
 *  machine has no system emoji font, so without this an emoji draws as a "NO GLYPH" box in frames and exports. */
export const EMOJI_FONT_FILE = 'noto-color-emoji.woff2';
/** Every font file a composition may load beside it: each text face and the emoji face. */
export const TEXT_FONT_FILES = [...FONTS.flatMap(font => textFontFaces(font).map(face => face.fileName)), EMOJI_FONT_FILE];
/** Emoji only. Symbols a text font draws itself (♥ ☀ ▶, digits, ©) stay in that font and its colour, so keycap
 *  sequences (1️⃣) are not covered. U+200D stays in: without it a joined emoji (a family) falls apart. */
const EMOJI_RANGE = 'U+200D,U+203C,U+2049,U+2139,U+2194-2199,U+21A9-21AA,U+231A-231B,U+2328,U+23CF,U+23E9-23F3,U+23F8-23FA,U+24C2,U+25AA-25AB,U+25B6,U+25C0,U+25FB-25FE,U+2600-27BF,U+2934-2935,U+2B05-2B07,U+2B1B-2B1C,U+2B50,U+2B55,U+3030,U+303D,U+3297,U+3299,U+1F000-1FAFF,U+E0020-E007F';
const EMOJI_PATTERN = new RegExp(`[${EMOJI_RANGE.split(',').filter(range => range !== 'U+200D').map(range => range.slice(2).split('-').map(code => `\\u{${code}}`).join('-')).join('')}]`, 'u');
/** True when the text has a character the emoji face draws (when the text font lacks it). */
export const hasEmoji = (text: string | undefined) => !!text && EMOJI_PATTERN.test(text);
/** `urls` maps a font id (or 'emoji') to its main file's URL; further faces of that font sit beside it in the same directory. */
export function textFontFaceCss(urls: Partial<Record<TextFontId | 'emoji', string>> = {}, scope: 'composition' | 'editor' = 'composition') {
  const safe = (url: string) => {
    if (!/^(https?:|blob:|\.\/|\/[^/])/i.test(url)) throw new Error('Font URLs must use HTTP, a blob URL, or a local path.');
    return url.replace(/'/g, '%27').replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/\\/g, '%5C');
  };
  const emoji = safe(urls.emoji ?? `/fonts/${EMOJI_FONT_FILE}`);
  return FONTS.flatMap(font => {
    const main = urls[font.id] ?? `/fonts/${font.fileName}`;
    const family = scope === 'editor' ? editorTextFont(font.id).family : font.family;
    return textFontFaces(font).map(face => {
      const url = face.fileName === font.fileName ? main : main.endsWith(font.fileName) ? main.slice(0, -font.fileName.length) + face.fileName : `/fonts/${face.fileName}`;
      // A second face of the same family and weight, limited to emoji: the family falls back to colour emoji wherever it
      // is used, with no change to any font-family value. Its weight descriptor must equal the text face's, or Chrome
      // treats it as another weight and never uses it. Declared first so the text face, declared later, keeps every
      // character it has (a ♥ stays a text glyph in the text colour). tech() keeps it from browsers that cannot draw
      // COLRv1 (they use the system emoji font instead of blank glyphs).
      return `@font-face{font-family:'${family}';font-style:normal;font-weight:${face.faceWeight};font-display:block;src:url('${emoji}') format('woff2') tech(color-COLRv1);unicode-range:${EMOJI_RANGE}}
@font-face{font-family:'${family}';font-style:normal;font-weight:${face.faceWeight};font-display:block;src:url('${safe(url)}') format('${face.fileName.endsWith('.ttf')?'truetype':'woff2'}')}`;
    });
  }).join('\n');
}
