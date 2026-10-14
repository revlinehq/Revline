export const TEXT_FONTS = [
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', fileName: 'space-grotesk-latin.woff2', weight: 700, faceWeight: '300 700' },
  { id: 'anton', label: 'Anton', family: 'Anton', fileName: 'anton.ttf', weight: 400, faceWeight: '400' },
  { id: 'dm-serif', label: 'DM Serif Display', family: 'DM Serif Display', fileName: 'dm-serif.ttf', weight: 400, faceWeight: '400' },
  { id: 'geist-mono', label: 'Geist Mono', family: 'Geist Mono', fileName: 'geist-mono-latin.woff2', weight: 700, faceWeight: '100 900' },
] as const;
export type TextFontId = typeof TEXT_FONTS[number]['id'];
export function textFont(id?: TextFontId) { return TEXT_FONTS.find(font => font.id === id) ?? TEXT_FONTS[0]; }
export function isTextFont(value: unknown): value is TextFontId { return TEXT_FONTS.some(font => font.id === value); }
export function textFontFaceCss(urls: Partial<Record<TextFontId, string>> = {}) {
  return TEXT_FONTS.map(font => {
    const url = urls[font.id] ?? `/fonts/${font.fileName}`;
    if (!/^(https?:|blob:|\.\/|\/[^/])/i.test(url)) throw new Error('Font URLs must use HTTP, a blob URL, or a local path.');
    const escaped = url.replace(/'/g, '%27').replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/\\/g, '%5C');
    return `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${font.faceWeight};font-display:block;src:url('${escaped}') format('${font.fileName.endsWith('.ttf')?'truetype':'woff2'}')}`;
  }).join('\n');
}
