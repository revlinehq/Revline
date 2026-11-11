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
/** Every font file a composition may load, for copying beside a rendered composition. */
export const TEXT_FONT_FILES = FONTS.flatMap(font => textFontFaces(font).map(face => face.fileName));
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
/** `urls` maps a font id to its main file's URL; further faces of that font sit beside it in the same directory. */
export function textFontFaceCss(urls: Partial<Record<TextFontId, string>> = {}, scope: 'composition' | 'editor' = 'composition') {
  return FONTS.flatMap(font => {
    const main = urls[font.id] ?? `/fonts/${font.fileName}`;
    return textFontFaces(font).map(face => {
      const url = face.fileName === font.fileName ? main : main.endsWith(font.fileName) ? main.slice(0, -font.fileName.length) + face.fileName : `/fonts/${face.fileName}`;
      if (!/^(https?:|blob:|\.\/|\/[^/])/i.test(url)) throw new Error('Font URLs must use HTTP, a blob URL, or a local path.');
      const escaped = url.replace(/'/g, '%27').replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/\\/g, '%5C');
      return `@font-face{font-family:'${scope === 'editor' ? editorTextFont(font.id).family : font.family}';font-style:normal;font-weight:${face.faceWeight};font-display:block;src:url('${escaped}') format('${face.fileName.endsWith('.ttf')?'truetype':'woff2'}')}`;
    });
  }).join('\n');
}
