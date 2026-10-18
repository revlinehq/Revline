export const TEXT_FONTS = [
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', fileName: 'space-grotesk-latin.woff2', weight: 700, faceWeight: '300 700' },
  { id: 'anton', label: 'Anton', family: 'Anton', fileName: 'anton.ttf', weight: 400, faceWeight: '400' },
  { id: 'dm-serif', label: 'DM Serif Display', family: 'DM Serif Display', fileName: 'dm-serif.ttf', weight: 400, faceWeight: '400' },
  { id: 'geist-mono', label: 'Geist Mono', family: 'Geist Mono', fileName: 'geist-mono-latin.woff2', weight: 700, faceWeight: '100 900' },
  { id: 'inter', label: 'Inter', family: 'Inter', fileName: 'inter.ttf', weight: 700, faceWeight: '100 900' },
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans', fileName: 'dm-sans.ttf', weight: 700, faceWeight: '100 1000' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', fileName: 'montserrat.ttf', weight: 700, faceWeight: '100 900' },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', fileName: 'poppins.ttf', weight: 700, faceWeight: '700' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', fileName: 'oswald.ttf', weight: 700, faceWeight: '200 700' },
  { id: 'bebas-neue', label: 'Bebas Neue', family: 'Bebas Neue', fileName: 'bebas-neue.ttf', weight: 400, faceWeight: '400' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', fileName: 'playfair-display.ttf', weight: 700, faceWeight: '400 900' },
  { id: 'caveat', label: 'Caveat', family: 'Caveat', fileName: 'caveat.ttf', weight: 700, faceWeight: '400 700' },
  { id: 'tiktok-sans', label: 'TikTok Sans', family: 'TikTok Sans', fileName: 'tiktok-sans.ttf', weight: 700, faceWeight: '300 900' },
] as const;
export type TextFontId = typeof TEXT_FONTS[number]['id'];
export function textFont(id?: TextFontId) { return TEXT_FONTS.find(font => font.id === id) ?? TEXT_FONTS[0]; }
/** Parent-document text faces must never override Next's application fonts. */
export function editorTextFont(id?: TextFontId) {
  const font = textFont(id);
  return { ...font, family: `Revline Text ${font.id}` };
}
export function isTextFont(value: unknown): value is TextFontId { return TEXT_FONTS.some(font => font.id === value); }
export function textFontFaceCss(urls: Partial<Record<TextFontId, string>> = {}, scope: 'composition' | 'editor' = 'composition') {
  return TEXT_FONTS.map(font => {
    const url = urls[font.id] ?? `/fonts/${font.fileName}`;
    if (!/^(https?:|blob:|\.\/|\/[^/])/i.test(url)) throw new Error('Font URLs must use HTTP, a blob URL, or a local path.');
    const escaped = url.replace(/'/g, '%27').replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/\\/g, '%5C');
    return `@font-face{font-family:'${scope === 'editor' ? editorTextFont(font.id).family : font.family}';font-style:normal;font-weight:${font.faceWeight};font-display:block;src:url('${escaped}') format('${font.fileName.endsWith('.ttf')?'truetype':'woff2'}')}`;
  }).join('\n');
}
