import { execFileSync } from 'node:child_process';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

// Run from the repository root with Node 22 and ffmpeg installed.
// Source frames stay in the ignored .data directory; only the final cards ship.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = `${root}/.data/share-cards`;
await mkdir(output, { recursive: true });
const brand = await readFile(`${root}/components/workspace/brand.tsx`, 'utf8');
const mark = brand.match(/<svg className="revline-mark"[\s\S]*?<\/svg><\/svg>/)?.[0]
  .replace('className="revline-mark"', 'width="36" height="36"');
if (!mark) throw new Error('Revline brand SVG was not found');
const font = (await readFile(`${root}/public/fonts/space-grotesk-latin.woff2`)).toString('base64');
const mono = (await readFile(`${root}/public/fonts/geist-mono-latin.woff2`)).toString('base64');
const cards = [
  {
    name: 'og-revline-v2', film: 'revline-launch.mp4', time: '16', crop: 'crop=1636:718:144:246',
    heading: 'The AI-native<br>video editor.',
    description: 'Cuts, captions, motion and sound.<br>Done for you.',
    label: 'MADE IN REVLINE',
    imageStyle: 'width:1000px;height:465px;right:-270px;top:140px;object-fit:cover;object-position:center;transform:rotate(-5deg)',
  },
  {
    name: 'og-sharingan-v1', film: 'inspo-original.mp4', time: '18.4',
    heading: '<span class="intro">Introducing:</span><br>Revline<br>Sharingan',
    description: 'AI editor that reverse engineers<br>any video',
    label: 'FROM ONE PASTED LINK',
    imageStyle: 'width:875px;height:630px;right:-220px;top:0;object-fit:cover;object-position:63% center',
  },
];
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  for (const card of cards) {
    const framePath = `${output}/${card.name}-frame.png`;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', card.time, '-i', `${root}/public/landing/${card.film}`, ...(card.crop ? ['-vf', card.crop] : []), '-frames:v', '1', framePath]);
    const frame = (await readFile(framePath)).toString('base64');
    await page.setContent(`<!doctype html><html><head><style>
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
      <div class="brand">${mark}<span>revline</span></div>
      <h1>${card.heading}</h1><p>${card.description}</p>
      <footer><span>${card.label}</span><span class="domain">tryrevline.com</span></footer>
    </body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${root}/public/${card.name}.png` });
    await rm(framePath);
  }
} finally {
  await browser.close();
}
