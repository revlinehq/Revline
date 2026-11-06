/**
 * Background candidates for a film, rendered as HTML (launch-films-motions skill, backgrounds page).
 * Pure: the editor tool resolves recipes and documents here, the MCP app and the chat's
 * choice card show the same documents. Colors follow the page's formulas, mixed in sRGB.
 */

export const BACKGROUND_STRUCTURES = ['cellGrid', 'dotGrid', 'perspectiveFloor', 'crosshairs'] as const;
export const BACKGROUND_ACCENTS = ['bloom', 'pixelField', 'pixelBleed', 'litCells'] as const;
export const BLEED_EDGES = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export const BACKGROUND_PREVIEW_URI = 'ui://revline/background-previews.html';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

export type BackgroundCandidate = {
  label: string;
  base: string;
  ink?: string;
  structure?: { kind: typeof BACKGROUND_STRUCTURES[number]; spacing?: number; color?: string };
  accent?: { kind: typeof BACKGROUND_ACCENTS[number]; color?: string; at?: string };
  note?: string;
};
export type KitColor = { name: string; value: string };
export type KitRoles = { background?: string; foreground?: string; accent?: string };

/** One resolved candidate: every hex the page draws with, and the one-line choice for the brief. */
export type BackgroundRecipe = {
  label: string;
  note?: string;
  base: string;
  ink: string;
  accent: string;
  accentWord: string;
  structure: { kind: typeof BACKGROUND_STRUCTURES[number]; spacing: number; color: string; marks?: string } | null;
  layer: { kind: typeof BACKGROUND_ACCENTS[number]; color: string; strong?: string; at: string } | null;
  line: string;
  warnings?: string[];
};
export type BackgroundBoard = { headline: string; font: { family: string; weight: string }; recipes: BackgroundRecipe[] };

const FALLBACK = { base: '#F7F5F1', ink: '#16141A', lightInk: '#F7F5F1', accent: '#7C3AED' };
const NAMED_BASES: Record<string, string> = { '#F7F5F1': 'warm paper', '#F7F8FD': 'cool white', '#FFFFFF': 'clean white', '#FCFEFB': 'clean white', '#07060B': 'dark' };
const SPACING = { cellGrid: 64, crosshairs: 64, perspectiveFloor: 80, dotGrid: 24 } as const;

type Rgb = [number, number, number];
/** #RGB, #RRGGBB, #RRGGBBAA or rgb()/rgba() as uppercase #RRGGBB; null for anything else. */
export function toHex(value: string): string | null {
  const text = value.trim();
  let match = /^#([0-9a-f]{3})$/i.exec(text);
  if (match) return `#${match[1].split('').map(char => char + char).join('')}`.toUpperCase();
  match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(text);
  if (match) return `#${match[1]}`.toUpperCase();
  match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(text);
  if (match) return rgbHex([Number(match[1]), Number(match[2]), Number(match[3])].map(channel => Math.min(255, channel)) as Rgb);
  return null;
}
const rgb = (hex: string): Rgb => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgb;
const rgbHex = (channels: Rgb) => `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
/** Straight sRGB mix: t = 0 is a, t = 1 is b. */
export const mix = (a: string, b: string, t: number) => { const from = rgb(a), to = rgb(b); return rgbHex(from.map((channel, index) => channel + (to[index] - channel) * t) as Rgb); };
const light = (hex: string) => rgb(hex).every(channel => channel >= 0xE8);
const dark = (hex: string) => rgb(hex).every(channel => channel <= 0x30);
const luminance = (hex: string) => { const [r, g, b] = rgb(hex).map(channel => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const chroma = (hex: string) => { const channels = rgb(hex); return Math.max(...channels) - Math.min(...channels); };

/** Which kit colors play background, foreground and accent: token names first, then the most saturated color. */
export function kitRoles(colors: readonly KitColor[]): KitRoles {
  const parsed = colors.flatMap(color => { const hex = toHex(color.value); return hex ? [{ name: color.name.toLowerCase(), hex }] : []; });
  const named = (pattern: RegExp, accept: (hex: string) => boolean = () => true) => parsed.find(color => pattern.test(color.name) && accept(color.hex))?.hex;
  const background = named(/(^|[-_ ])(bg|background|canvas|surface|base|paper)([-_ ]|$)/);
  const foreground = named(/(^|[-_ ])(fg|foreground|text|ink|body|copy)([-_ ]|$)/);
  const accent = named(/(accent|primary|brand|theme|highlight)/, hex => chroma(hex) >= 48)
    ?? [...parsed].filter(color => color.hex !== background && color.hex !== foreground && chroma(color.hex) >= 48).sort((a, b) => chroma(b.hex) - chroma(a.hex))[0]?.hex;
  return { ...(background ? { background } : {}), ...(foreground ? { foreground } : {}), ...(accent ? { accent } : {}) };
}

/** Fill every missing color from the kit with the page's formulas. */
export function resolveCandidate(candidate: BackgroundCandidate, roles: KitRoles): BackgroundRecipe {
  const base = toHex(candidate.base);
  if (!base) throw new Error(`${candidate.label}: base must be a hex color such as #F7F5F1.`);
  const darkBase = luminance(base) < 0.2;
  const given = (value: string | undefined, role: string) => { if (value === undefined) return undefined; const hex = toHex(value); if (!hex) throw new Error(`${candidate.label}: ${role} must be a hex color.`); return hex; };
  const ink = given(candidate.ink, 'ink') ?? (darkBase ? (roles.background && light(roles.background) ? roles.background : FALLBACK.lightInk) : (roles.foreground && dark(roles.foreground) ? roles.foreground : FALLBACK.ink));
  const accent = roles.accent ?? FALLBACK.accent;
  const accentWord = darkBase ? accent : mix(accent, '#000000', 0.1);
  // Lines and dots step away from the base: darker on a light base, lighter on a dark one.
  const step = (t: number) => mix(base, darkBase ? '#FFFFFF' : '#000000', t);
  const structure = candidate.structure ? (() => {
    const { kind } = candidate.structure;
    const color = given(candidate.structure.color, 'structure.color') ?? step(kind === 'dotGrid' ? 0.13 : 0.07);
    return { kind, spacing: candidate.structure.spacing ?? SPACING[kind], color, ...(kind === 'crosshairs' ? { marks: accent } : {}) };
  })() : null;
  const layer = candidate.accent ? (() => {
    const { kind } = candidate.accent;
    const at = candidate.accent.at?.trim() || (kind === 'pixelBleed' ? 'bottom-left' : '50% 50%');
    if (kind === 'pixelBleed' ? !(BLEED_EDGES as readonly string[]).includes(at) : !/^\d{1,3}% \d{1,3}%$/.test(at)) throw new Error(kind === 'pixelBleed' ? `${candidate.label}: accent.at for pixelBleed is an edge or corner: ${BLEED_EDGES.join(', ')}.` : `${candidate.label}: accent.at is the focal point as "X% Y%", for example "50% 45%".`);
    const color = given(candidate.accent.color, 'accent.color') ?? (kind === 'bloom' ? mix(base, accent, 0.2) : kind === 'litCells' ? mix(base, accent, 0.08) : accent);
    return { kind, color, ...(kind === 'litCells' ? { strong: mix(base, accent, 0.16) } : {}), at };
  })() : null;
  const words = { cellGrid: 'cell grid', dotGrid: 'dot grid', perspectiveFloor: 'perspective floor', crosshairs: 'cell grid with accent crosshairs', bloom: 'bloom', pixelField: 'pixel field', pixelBleed: 'pixel bleed', litCells: 'lit cells' } as const;
  const line = [
    `Base ${NAMED_BASES[base] ? `${NAMED_BASES[base]} ` : ''}${base}`, `ink ${ink}`,
    structure ? `structure ${words[structure.kind]} every ${structure.spacing} px in ${structure.color}${structure.marks ? `, marks ${structure.marks}` : ''}` : 'structure none',
    layer ? `accent ${words[layer.kind]} ${layer.color}${layer.strong ? ` (one cell ${layer.strong})` : ''} at ${layer.at}` : 'accent none',
    `accent word ${accentWord}`,
  ].join(', ') + '.';
  const warnings = luminance(base) < luminance('#E0E0E0') ? ['Base darker than #E0E0E0: the backgrounds page allows it for the end card or one punch beat, or when the user asked for dark.'] : [];
  return { label: candidate.label, ...(candidate.note ? { note: candidate.note } : {}), base, ink, accent, accentWord, structure, layer, line, ...(warnings.length ? { warnings } : {}) };
}

// Tiles are drawn in the frame's 1920 x 1080 space and scale with the tile through container units.
const W = 1920, H = 1080;
const q = (n: number) => `${+(n / 19.2).toFixed(3)}cqw`;
const hair = (n: number) => `max(1px,${q(n)})`;
const esc = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
/** Seeded integer hash in [0, 1); the browser's pixel painter uses the same one. */
const hash = (x: number, y: number, s: number) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const seed = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const lines = (color: string, spacing: number) => `background-image:linear-gradient(to right,${color} 0 ${hair(1)},transparent ${hair(1)}),linear-gradient(to bottom,${color} 0 ${hair(1)},transparent ${hair(1)});background-size:${q(spacing)} ${q(spacing)}`;

function tile(board: BackgroundBoard, recipe: BackgroundRecipe, index: number, caption: boolean) {
  const { structure: S, layer: A } = recipe, text = board.headline;
  // One or two balanced lines inside the middle 1500 px.
  const size = Math.round(Math.max(48, Math.min(104, (1500 / (text.length * 0.55)) * (text.length > 26 ? 2 : 1))));
  const rows = text.length * 0.55 * size > 1500 ? 2 : 1;
  const textWidth = Math.min(1500, (text.length * 0.55 * size) / rows + 160), textHeight = rows * size * 1.1 + 80;
  const grid = S?.kind === 'cellGrid' || S?.kind === 'crosshairs', cell = grid ? S!.spacing : 64;
  // A grid puts the headline on a cell-aligned box filled with the base.
  const box = grid ? (() => { const w = cell * Math.ceil(textWidth / cell), h = cell * Math.ceil(textHeight / cell); return { x: cell * Math.round((W - w) / 2 / cell), y: cell * Math.round((H - h) / 2 / cell), w, h }; })() : null;
  const at = (x: number, y: number, w: number, h: number) => `left:${q(x)};top:${q(y)};width:${q(w)};height:${q(h)}`;
  const layers: string[] = [];
  const dot = `max(.5px,${q(1)})`;
  if (S?.kind === 'dotGrid') layers.push(`<div class="l" style="background-image:radial-gradient(circle at ${dot} ${dot},${S.color} ${dot},transparent calc(${dot} + .5px));background-size:${q(S.spacing)} ${q(S.spacing)}"></div>`);
  else if (S?.kind === 'perspectiveFloor') layers.push(`<div class="l f" style="perspective:${q(1400)}"><div class="p" style="${lines(S.color, S.spacing)}"></div></div>`);
  else if (S) layers.push(`<div class="l" style="${lines(S.color, S.spacing)}"></div>`);
  if (A?.kind === 'bloom') layers.push(`<div class="l" style="background:radial-gradient(42% 55% at ${A.at},${A.color} 0%,${A.color}8C 40%,transparent 75%)"></div>`);
  if (A?.kind === 'litCells') {
    const s = seed(recipe.label), cols = Math.ceil(W / cell), rowsOfCells = Math.ceil(H / cell), clear = box ?? { x: (W - textWidth) / 2, y: (H - textHeight) / 2, w: textWidth, h: textHeight };
    for (let k = 0, lit = 0; k < 400 && lit < 6; k++) {
      const x = Math.floor(hash(k, 1, s) * cols) * cell, y = Math.floor(hash(k, 2, s) * rowsOfCells) * cell;
      if (x + cell > clear.x - cell && x < clear.x + clear.w + cell && y + cell > clear.y - cell && y < clear.y + clear.h + cell) continue;
      layers.push(`<div class="c" style="${at(x, y, cell, cell)};background:${lit++ === 0 ? A.strong : A.color}"></div>`);
    }
  }
  if (A?.kind === 'pixelField' || A?.kind === 'pixelBleed') layers.push(`<canvas class="l" data-k="${A.kind}" data-c="${A.color}" data-at="${A.at}" data-s="${seed(recipe.label)}" data-w="${Math.round(textWidth)}" data-h="${Math.round(textHeight)}"></canvas>`);
  if (box) layers.push(`<div class="c" style="${at(box.x, box.y, box.w, box.h)};background:${recipe.base};box-shadow:0 0 0 ${hair(1)} ${S!.color}">${S!.marks ? ['0% 0%', '100% 0%', '0% 100%', '100% 100%'].map(corner => `<i class="m" style="left:${corner.split(' ')[0]};top:${corner.split(' ')[1]};--m:${S!.marks}"></i>`).join('') : ''}</div>`);
  const words = text.split(' '), last = words.pop()!;
  layers.push(`<div class="h" style="font-size:${q(size)};padding:0 ${q((W - (box?.w ?? textWidth)) / 2 + 64)}"><span>${esc(words.length ? `${words.join(' ')} ` : '')}<span style="color:${recipe.accentWord}">${esc(last)}</span></span></div>`);
  const stage = `<div class="s" style="background:${recipe.base};color:${recipe.ink}">${layers.join('')}</div>`;
  if (!caption) return stage;
  const swatches: [string, string][] = [['Base', recipe.base], ['Ink', recipe.ink], ['Accent', recipe.accent], ['Accent word', recipe.accentWord]];
  if (S) swatches.push([S.kind === 'dotGrid' ? 'Dots' : 'Lines', S.color]);
  if (A) swatches.push([A.kind === 'bloom' ? 'Bloom' : A.kind === 'litCells' ? 'Lit cells' : 'Pixels', A.color]);
  if (A?.strong) swatches.push(['Lit cell', A.strong]);
  return `<figure class="t">${stage}<figcaption><div class="top"><b>${index + 1}. ${esc(recipe.label)}</b><button type="button" class="pick" data-pick="${index}">Use this</button></div>${recipe.note ? `<p class="note">${esc(recipe.note)}</p>` : ''}<div class="sw">${swatches.map(([role, hex]) => `<span><i style="background:${hex}"></i>${role} ${hex}</span>`).join('')}</div></figcaption></figure>`;
}

// Pixel field and bleed: 12 px cells with 2 px gaps at 10-100% opacity from the seeded hash, repainted at the tile's size.
const PAINT = String.raw`function hash(x,y,s){var h=(x*374761393+y*668265263+s*1274126177)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return(h>>>0)/4294967296}
function paint(){document.querySelectorAll('canvas[data-k]').forEach(function(c){var w=c.clientWidth;if(!w)return;var r=devicePixelRatio||1;c.width=Math.round(w*r);c.height=Math.round(w*r*9/16);
var g=c.getContext('2d'),k=c.dataset.k,at=c.dataset.at,s=+c.dataset.s,z=c.width/1920,p=/^(\d+)% (\d+)%$/.exec(at)||[0,50,50],fx=19.2*p[1],fy=10.8*p[2],hw=c.dataset.w/2+96,hh=c.dataset.h/2+64;g.fillStyle=c.dataset.c;
for(var y=0;y<78;y++)for(var x=0;x<138;x++){var px=x*14,py=y*14,d;
if(k=='pixelBleed'){var nx=px/1920,ny=py/1080,L=at.indexOf('left')>=0,T=at.indexOf('top')>=0,ex=L?nx:at.indexOf('right')>=0?1-nx:9,ey=T?ny:at.indexOf('bottom')>=0?1-ny:9,e=at.indexOf('-')>0?Math.hypot(ex,ey):Math.min(ex,ey);d=Math.max(0,1-e/.45);d*=d}
else{var e2=Math.max(Math.abs(px+6-fx)/hw,Math.abs(py+6-fy)/hh);d=e2<1?.3:Math.max(0,.3-(e2-1)*.8)}
if(hash(x,y,s)<d){g.globalAlpha=.1+.9*hash(y,x,s+7);g.fillRect(px*z,py*z,12*z,12*z)}}})}
addEventListener('resize',paint);addEventListener('load',paint);paint();`;

const STAGE_CSS = `*{box-sizing:border-box}html,body{margin:0}.s{position:relative;aspect-ratio:16/9;overflow:hidden;container-type:inline-size}.l{position:absolute;inset:0;width:100%;height:100%}.f{-webkit-mask-image:linear-gradient(to top,#000,transparent 60%);mask-image:linear-gradient(to top,#000,transparent 60%)}.p{position:absolute;left:-100%;right:-100%;bottom:0;height:200%;transform-origin:50% 100%;transform:rotateX(62deg)}.c{position:absolute}.m{position:absolute;width:max(5px,.625cqw);height:max(5px,.625cqw);transform:translate(-50%,-50%);background:linear-gradient(var(--m),var(--m)) center/100% max(1px,.078cqw) no-repeat,linear-gradient(var(--m),var(--m)) center/max(1px,.078cqw) 100% no-repeat}.h{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.08;letter-spacing:-.02em;text-wrap:balance}`;
const BOARD_CSS = `body{font:13px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;color-scheme:light dark;color:CanvasText;background:transparent}#r{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:4px}.t{margin:0;min-width:0}.t .s{border-radius:8px;box-shadow:0 0 0 1px rgba(128,128,128,.25)}figcaption{padding:8px 2px 0}.top{display:flex;align-items:center;justify-content:space-between;gap:8px}.note{margin:2px 0 0;opacity:.7}.sw{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.85}.sw span{display:inline-flex;align-items:center;gap:4px}.sw i{width:10px;height:10px;border-radius:2px;box-shadow:0 0 0 1px rgba(128,128,128,.4)}.pick{display:none;font:inherit;font-weight:500;padding:4px 10px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;cursor:pointer;outline:none}.pick:hover{background:rgba(128,128,128,.16)}.app .pick{display:inline-block}`;

/** The kit's heading font from Google Fonts, the only network request a preview makes. */
const fontLink = (font: BackgroundBoard['font']) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}:wght@${Number.parseInt(font.weight) || 600}&display=swap`;
const fontCss = (font: BackgroundBoard['font']) => `.h{font-family:"${font.family.replace(/["\\<]/g, '')}",ui-sans-serif,system-ui,sans-serif;font-weight:${Number.parseInt(font.weight) || 600}}`;
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:`;
const page = (title: string, css: string, body: string, script: string, head = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<title>${esc(title)}</title><style>${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const pixels = (recipes: BackgroundRecipe[]) => recipes.some(recipe => recipe.layer?.kind === 'pixelField' || recipe.layer?.kind === 'pixelBleed');
const fixedHead = (font: BackgroundBoard['font']) => `<meta http-equiv="Content-Security-Policy" content="${CSP}"><link rel="stylesheet" href="${fontLink(font)}">`;

/** The board's tiles as one fragment, for the MCP App view to place. */
export const boardTiles = (board: BackgroundBoard) => board.recipes.map((recipe, index) => tile(board, recipe, index, true)).join('');
/** Every candidate as a 16:9 tile with its label and resolved hex values, in one self-contained document. */
export const boardDocument = (board: BackgroundBoard) => page('Background candidates', STAGE_CSS + BOARD_CSS + fontCss(board.font), `<div id="r">${boardTiles(board)}</div>`, pixels(board.recipes) ? PAINT : '', fixedHead(board.font));
/** One candidate full-bleed, for the chat's choice card (a sandboxed 16:9 iframe). */
export const candidateDocument = (board: BackgroundBoard, index: number) => page(board.recipes[index].label, `${STAGE_CSS}body{overflow:hidden}${fontCss(board.font)}`, tile(board, board.recipes[index], index, false), pixels([board.recipes[index]]) ? PAINT : '', fixedHead(board.font));

/**
 * The MCP App view (io.modelcontextprotocol/ui, 2026-01-26). It speaks the postMessage protocol, places the tiles from
 * the tool result's structuredContent, and posts a pick to the chat as the user's message. The host applies the CSP
 * the resource declares, so the font link is added once the result names the font.
 */
export const mcpAppDocument = () => page('Background candidates', STAGE_CSS + BOARD_CSS, '<div id="r" class="app"></div>', PAINT + String.raw`
(function(){var id=0,init=0,data=null,root=document.getElementById('r');function send(m){parent.postMessage(m,'*')}
function req(method,params){send({jsonrpc:'2.0',id:++id,method:method,params:params});return id}
function show(s){if(!s||typeof s.tiles!='string')return;data=s;var f=s.font||{};if(f.family){var l=document.getElementById('kf')||document.head.appendChild(document.createElement('link'));l.id='kf';l.rel='stylesheet';l.href=s.fontUrl;var st=document.getElementById('kc')||document.head.appendChild(document.createElement('style'));st.id='kc';st.textContent=s.fontCss}root.innerHTML=s.tiles;paint()}
root.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-pick]');if(!b||!data)return;var r=data.recipes[+b.dataset.pick],text='Use background '+(+b.dataset.pick+1)+': '+r.label+'. '+r.line;
 if(window.openai&&window.openai.sendFollowUpMessage)window.openai.sendFollowUpMessage({prompt:text});else req('ui/message',{role:'user',content:{type:'text',text:text}})});
addEventListener('message',function(e){var m=e.data;if(!m||m.jsonrpc!=='2.0')return;
 if(m.id===init&&!m.method){var v=m.result&&m.result.hostContext&&m.result.hostContext.styles&&m.result.hostContext.styles.variables;if(v)for(var k in v)document.documentElement.style.setProperty(k,v[k]);send({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});return}
 if(m.method==='ui/notifications/tool-result')show(m.params&&m.params.structuredContent);
 if(m.method&&m.id!=null&&(m.method==='ui/resource-teardown'||m.method==='ping'))send({jsonrpc:'2.0',id:m.id,result:{}})});
init=req('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Revline background candidates',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline']}});
if(window.openai&&window.openai.toolOutput)show(window.openai.toolOutput);
if(window.ResizeObserver)new ResizeObserver(function(){var b=document.documentElement;send({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{width:b.scrollWidth,height:b.scrollHeight}})}).observe(document.body)})();`);

/** What the MCP App view draws: the tiles plus the font, and the recipes a pick posts back. */
export const mcpAppData = (board: BackgroundBoard) => ({ headline: board.headline, font: board.font, fontUrl: fontLink(board.font), fontCss: fontCss(board.font), recipes: board.recipes, tiles: boardTiles(board) });
