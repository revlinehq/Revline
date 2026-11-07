import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

// Run from the repository root with Node 22 and ffmpeg installed:
//   node scripts/generate-share-cards.mjs [card-name ...]
// With no names every card is rendered. Source frames, cached fonts and the
// alternative directions stay in the ignored .data directory; only cards with
// a `file` in public/ ship. Set PUPPETEER_NO_SANDBOX=1 where Chrome's sandbox
// is unavailable (the page is local, trusted HTML).
const root = fileURLToPath(new URL('..', import.meta.url));
const output = `${root}/.data/share-cards`;
await mkdir(output, { recursive: true });
const brand = await readFile(`${root}/components/workspace/brand.tsx`, 'utf8');
const markSvg = brand.match(/<svg className="revline-mark"[\s\S]*?<\/svg><\/svg>/)?.[0];
if (!markSvg) throw new Error('Revline brand SVG was not found');
const mark = size => markSvg.replace('className="revline-mark"', `width="${size}" height="${size}"`);
const base64 = async path => (await readFile(path)).toString('base64');
const font = await base64(`${root}/public/fonts/space-grotesk-latin.woff2`);
const mono = await base64(`${root}/public/fonts/geist-mono-latin.woff2`);

// The landing page's own faces (Outfit headings, Geist body) come from
// next/font, so they are fetched once from a pinned Google Fonts commit.
const googleFonts = 'https://raw.githubusercontent.com/google/fonts/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl';
async function cachedFont(name, path) {
  const file = `${output}/${name}.ttf`;
  if (!existsSync(file)) {
    const response = await fetch(`${googleFonts}/${path}`);
    if (!response.ok) throw new Error(`Could not download ${name}: ${response.status}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  return base64(file);
}
const outfit = await cachedFont('outfit', 'outfit/Outfit%5Bwght%5D.ttf');
const geist = await cachedFont('geist', 'geist/Geist%5Bwght%5D.ttf');

// Real editor frames from the landing launch film, cropped so every UI word
// stays readable when X or iMessage shows the card about 500px wide.
const shots = {
  prompt: { film: 'revline-launch.mp4', time: '19.8', crop: 'crop=822:800:548:0' },
  composer: { film: 'revline-launch.mp4', time: '18.45', crop: 'crop=823:314:546:468' },
  takes: { film: 'revline-launch.mp4', time: '16.8', crop: 'crop=852:250:580:348' },
};

const grain = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;

const paperStyles = `
  @font-face{font-family:Outfit;src:url(data:font/ttf;base64,${outfit});font-weight:100 900}
  @font-face{font-family:Geist;src:url(data:font/ttf;base64,${geist});font-weight:100 900}
  @font-face{font-family:Grotesk;src:url(data:font/woff2;base64,${font})}
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;overflow:hidden;position:relative;background:#f8f7f4;color:#121212;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
  .bloom{position:absolute;inset:0;filter:blur(40px)}
  .grain{position:absolute;inset:0;background:${grain};opacity:.16;mix-blend-mode:multiply}
  .brand{position:absolute;display:flex;align-items:center;gap:10px;font:650 34px Grotesk,sans-serif;letter-spacing:-1px;color:#1c1c1c}
  h1{position:absolute;margin:0;font-family:Outfit,sans-serif;font-weight:400;color:#121212}
  p{position:absolute;margin:0;color:#4d4d4d}
  .domain{position:absolute;font:500 26px Geist,sans-serif;letter-spacing:-.3px;color:#3d3d3d}
  .shot{position:absolute;display:block;border-radius:14px;border:1px solid #00000014;box-shadow:0 2px 6px #12121214,0 28px 60px -18px #12121240}
`;

const directions = {
  // A: split layout, the agent conversation from the real editor on the right.
  'og-revline-v3-prompt': {
    shot: 'prompt',
    html: shot => `
      <div class="bloom" style="background:radial-gradient(520px 420px at 900px 330px,#cdc3e4 0%,#cdc3e400 70%),radial-gradient(420px 360px at 1110px 600px,#ecd3c3 0%,#ecd3c300 70%),radial-gradient(380px 320px at 690px 80px,#d5dbd4 0%,#d5dbd400 70%)"></div>
      <div class="grain"></div>
      <div class="brand" style="left:64px;top:56px">${mark(36)}<span>revline</span></div>
      <h1 style="left:62px;top:170px;font-size:72px;line-height:1.04;letter-spacing:-2.4px">The AI-native<br>video editor.</h1>
      <p style="left:64px;top:348px;font-size:30px;line-height:1.36;letter-spacing:-.4px">Cuts, captions, motion<br>and sound. Done for you.</p>
      <div class="domain" style="left:64px;bottom:52px">tryrevline.com</div>
      <img class="shot" src="${shot}" style="left:600px;top:-1px;width:540px;height:auto;border-top:0;border-radius:0 0 16px 16px">`,
  },
  // B: the landing hero, centred copy over a strip of real takes Revline kept and cut.
  'og-revline-v3-hero': {
    shot: 'takes',
    html: shot => `
      <div class="bloom" style="background:radial-gradient(720px 340px at 600px 470px,#cbc0e5 0%,#cbc0e500 72%),radial-gradient(380px 260px at 210px 600px,#e9d2c4 0%,#e9d2c400 70%),radial-gradient(380px 260px at 1010px 620px,#d3dad3 0%,#d3dad300 70%)"></div>
      <div class="grain"></div>
      <div class="brand" style="left:40px;top:34px;font-size:30px">${mark(32)}<span>revline</span></div>
      <div class="domain" style="right:40px;top:40px;font-size:24px">tryrevline.com</div>
      <h1 style="left:0;right:0;top:92px;text-align:center;font-size:70px;line-height:1.06;letter-spacing:-2.2px">The AI-native video editor.</h1>
      <p style="left:0;right:0;top:184px;text-align:center;font-size:30px;line-height:1.36;letter-spacing:-.4px">Cuts, captions, motion and sound. Done for you.</p>
      <img class="shot" src="${shot}" style="left:${(1200 - 1120) / 2}px;top:270px;width:1120px;height:auto">`,
  },
  // C: an editorial headline with the real prompt box as the single product object.
  'og-revline-v3-composer': {
    shot: 'composer',
    html: shot => `
      <div class="bloom" style="background:radial-gradient(640px 380px at 860px 520px,#cbc1e2 0%,#cbc1e200 70%),radial-gradient(460px 320px at 1160px 260px,#ebd4c6 0%,#ebd4c600 70%),radial-gradient(420px 300px at 420px 640px,#d4dad3 0%,#d4dad300 70%)"></div>
      <div class="grain"></div>
      <div class="brand" style="left:64px;top:56px">${mark(36)}<span>revline</span></div>
      <div class="domain" style="right:64px;top:62px">tryrevline.com</div>
      <h1 style="left:62px;top:150px;font-size:84px;line-height:1.02;letter-spacing:-3px">The AI-native<br>video editor.</h1>
      <p style="left:64px;top:356px;font-size:30px;line-height:1.36;letter-spacing:-.4px">Cuts, captions, motion<br>and sound. Done for you.</p>
      <img class="shot" src="${shot}" style="left:520px;top:352px;width:640px;height:auto;border-radius:20px">`,
  },
};
// The direction that ships as the live link card; the others are kept for comparison.
const shipped = { 'og-revline-v3-hero': 'og-revline-v3' };

const darkCards = [
  {
    name: 'og-sharingan-v1', film: 'inspo-original.mp4', time: '18.4',
    heading: '<span class="intro">Introducing:</span><br>Revline<br>Sharingan',
    description: 'AI editor that reverse engineers<br>any video',
    label: 'FROM ONE PASTED LINK',
    imageStyle: 'width:875px;height:630px;right:-220px;top:0;object-fit:cover;object-position:63% center',
  },
];

function grabFrame(name, { film, time, crop }) {
  const framePath = `${output}/${name}-frame.png`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', time, '-i', `${root}/public/landing/${film}`, ...(crop ? ['-vf', crop] : []), '-frames:v', '1', framePath]);
  return framePath;
}

const darkCardHtml = (card, frame) => `<!doctype html><html><head><style>
      @font-face{font-family:Grotesk;src:url(data:font/woff2;base64,${font})}
      @font-face{font-family:Mono;src:url(data:font/woff2;base64,${mono})}
      *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:#111;color:#f5f5f2;font-family:Grotesk,sans-serif}
      .frame{position:absolute;${card.imageStyle};border:1px solid #ffffff28;border-radius:12px;box-shadow:0 32px 90px #0009}
      .shade{position:absolute;inset:0;background:linear-gradient(90deg,#111 0%,#111 36%,#111f 40%,#111d 47%,#1114 64%,#1110 83%),linear-gradient(0deg,#111 0%,#1110 32%,#1110 85%,#1117)}
      .brand{position:absolute;left:58px;top:44px;display:flex;align-items:center;gap:10px;font-weight:650;font-size:36px;letter-spacing:-1.3px}
      h1{position:absolute;left:58px;top:181px;margin:0;font-size:70px;font-weight:600;line-height:1.04;letter-spacing:-3.5px}
      .intro{font-size:28px;line-height:1.8;letter-spacing:-.6px;color:#b5b5af;font-weight:400}
      .sharing h1{top:143px;font-size:78px;line-height:1.01}
      p{position:absolute;left:60px;top:367px;margin:0;font-size:27px;line-height:1.4;letter-spacing:-.55px;color:#bcbcb6}
      .sharing p{top:400px}
      footer{position:absolute;left:60px;right:56px;bottom:39px;padding-top:19px;border-top:1px solid #ffffff28;display:flex;justify-content:space-between;align-items:center;font:13px Mono,monospace;letter-spacing:1.5px;color:#aaa}
      .domain{font-family:Grotesk;font-size:20px;letter-spacing:-.4px;color:#e1e1da}
    </style></head><body class="${card.name.includes('sharingan') ? 'sharing' : ''}">
      <img class="frame" src="data:image/png;base64,${frame}"><div class="shade"></div>
      <div class="brand">${mark(36)}<span>revline</span></div>
      <h1>${card.heading}</h1><p>${card.description}</p>
      <footer><span>${card.label}</span><span class="domain">tryrevline.com</span></footer>
    </body></html>`;

const requested = new Set(process.argv.slice(2));
const wanted = name => requested.size === 0 || requested.has(name) || requested.has(shipped[name]);
const browser = await puppeteer.launch({ headless: true, args: process.env.PUPPETEER_NO_SANDBOX ? ['--no-sandbox'] : [] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  async function capture(html, path) {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path });
  }
  for (const [name, direction] of Object.entries(directions)) {
    if (!wanted(name)) continue;
    const framePath = grabFrame(name, shots[direction.shot]);
    const shot = `data:image/png;base64,${await base64(framePath)}`;
    const html = `<!doctype html><html><head><style>${paperStyles}</style></head><body>${direction.html(shot)}</body></html>`;
    await capture(html, `${output}/${name}.png`);
    if (shipped[name]) await capture(html, `${root}/public/${shipped[name]}.png`);
    await rm(framePath);
  }
  for (const card of darkCards) {
    if (!wanted(card.name)) continue;
    const framePath = grabFrame(card.name, card);
    await capture(darkCardHtml(card, await base64(framePath)), `${root}/public/${card.name}.png`);
    await rm(framePath);
  }
} finally {
  await browser.close();
}
