/** A motion clip without rendered frames yet: a muted film-grain gradient, tinted per scene so neighbouring clips read apart. */
export function sceneHue(title: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) { hash ^= title.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0) % 360;
}

const escape = (text: string) => text.replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]!);

/** The same placeholder as an image, for covers (tabs, export, shares): square, so any aspect crop keeps the centered title. */
export function scenePlaceholderCover(title: string) {
  const hue = sceneHue(title), name = title.length > 18 ? `${title.slice(0, 17).trimEnd()}…` : title;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs>`
    + `<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 16% 20%)"/><stop offset="1" stop-color="hsl(${(hue + 38) % 360} 12% 13%)"/></linearGradient>`
    + `<radialGradient id="g" cx=".28" cy=".3" r=".75"><stop offset="0" stop-color="hsl(${hue} 22% 46%)" stop-opacity=".55"/><stop offset="1" stop-color="hsl(${hue} 22% 46%)" stop-opacity="0"/></radialGradient>`
    + `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .16 0"/></filter></defs>`
    + `<rect width="400" height="400" fill="url(#b)"/><rect width="400" height="400" fill="url(#g)"/><rect width="400" height="400" filter="url(#n)"/>`
    + `<text x="200" y="207" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="21" font-weight="500" fill="#ECEAE6" fill-opacity=".86">${escape(name)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
