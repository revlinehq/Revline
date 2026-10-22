import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import sharp from "sharp";
const source = "/tmp/revline-thin-split-owned-black-intro.mp4";
if (!await stat(source).catch(() => null)) execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=20", "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,2)'", "-threads", "1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "600", "-keyint_min", "600", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", source]);
const video = await readFile(source), bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';import{Preview}from'./components/editor/preview';import{TimelinePanel}from'./components/editor/timeline';import{TooltipProvider}from'./components/ui/tooltip';import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';import{splitClip}from'./lib/editor/operations';import './app/editor.css';import './components/workspace/workspace-pages.css';
const enabled=new URLSearchParams(location.search).get('fx')!=='0',initial={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[{id:'initial',kind:'video',assetId:'owned',track:1,start:0,duration:14,sourceStart:6,volume:0,fit:'contain',...(enabled?{dither:{enabled:true,amount:1,levels:4,size:2},colorGrade:{enabled:true,contrast:1.3,exposure:0,saturation:1.48,temperature:-54,tint:-19,vibrance:58}}:{})}]},store=createEditorStore(initial);store.setState({zoom:2});window.errors=[];window.splitOwnedClip=splitClip;
const assets=[{_id:'owned',kind:'video',fileName:'Owned sparse GOP1080',width:1920,height:1080,duration:20,url:location.origin+'/source.mp4'},{_id:'still',kind:'image',fileName:'Owned magenta still',width:1920,height:1080,url:location.origin+'/still.svg'}];
function Fixture(){const ref=useRef(null),timeline=useEditorState(s=>s.timeline),time=useEditorState(s=>s.playhead),playing=useEditorState(s=>s.playing);window.fixture={store,seek:t=>ref.current.seek(t),play:()=>ref.current.play(),pause:()=>ref.current.pause(),split:(time,id)=>{ref.current.seek(time);const before=store.getState().timeline,clip=before.clips.find(c=>time>c.start+1e-6&&time<c.start+c.duration-1e-6);if(!clip)throw Error('No split target');store.getState().edit(splitClip(before,clip.id,time,id));}};return <><div className='stage'><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onTime={t=>store.setState({playhead:t})} onPlaying={p=>store.setState({playing:p})} onError={e=>window.errors.push(e)}/></div><TimelinePanel timeline={timeline} assets={assets} selected={null} time={time} playing={playing} onSelect={()=>{}} onSeek={t=>ref.current.seek(t)} onChange={t=>store.getState().edit(t)} onSplit={()=>{}} onDelete={()=>{}} onDuplicate={()=>{}} onAddText={()=>{}} onError={e=>window.errors.push(e)}/></>}
createRoot(document.getElementById('root')).render(<TooltipProvider><EditorStateProvider store={store}><Fixture/></EditorStateProvider></TooltipProvider>);
` }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, outdir: "/tmp/revline-thin-split", define: { "process.env.NODE_ENV": '"production"' } });
const requests = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  let body;
  if (path === "/source.mp4") body = video;
  else if (path === "/still.svg") body = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="#ff00ff" d="M0 0H1920V1080H0Z"/></svg>';
  else if (path === "/fixture.js") body = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
  else if (path === "/fixture.css") body = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
  else if (path.startsWith("/vendor/") || path.startsWith("/fonts/")) body = await readFile("public" + path).catch(() => null);
  else body = '<html data-workspace-theme="dark"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#171717}#root{width:1100px;height:760px}.stage,.preview-canvas{position:relative;width:640px;height:360px}.hyperframes-host{position:absolute;inset:0}.custom-timeline{height:300px}</style><div id="root"></div><script src="/fixture.js"><\/script>';
  if (body == null) {
    res.writeHead(404).end();
    return;
  }
  body = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? ""), start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  if (path === "/source.mp4") requests.push({ at: Date.now(), start, end });
  res.writeHead(range ? 206 : 200, { "Content-Type": path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".mp4") ? "video/mp4" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".woff2") ? "font/woff2" : "text/html", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...range ? { "Content-Range": `bytes ${start}-${end}/${body.length}` } : {} });
  res.end(body.subarray(start, end + 1));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--js-flags=--max-old-space-size=768"] });
try {
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.text().includes("Too many active WebGL")) errors.push(m.text());
  });
  page.setDefaultTimeout(2e4);
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto("http://127.0.0.1:" + server.address().port + (process.env.REVLINE_SPLIT_NO_FX === "1" ? "/?fx=0" : ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.style.zIndex === "1");
  await page.waitForSelector(".filmstrip-frame img");
  await page.evaluate(() => {
    const player = document.querySelector("hyperframes-player"), doc = player.iframeElement.contentDocument;
    window.original = { player, doc, video: doc.querySelector("video"), events: { loadstart: 0, emptied: 0, contextlost: 0 } };
    for (const name of ["loadstart", "emptied"]) window.original.video.addEventListener(name, () => window.original.events[name]++);
    doc.addEventListener("webglcontextlost", () => window.original.events.contextlost++, true);
    window.fixture.seek(7.8);
  });
  await page.waitForFunction(() => !window.original.video.seeking && Math.abs(window.original.video.currentTime - 13.8) < 0.05);
  const baselineRequests = requests.length;
  const started = Date.now();
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) window.fixture.split(7.8 + i / 30, "piece-" + i);
  });
  const checkpoints = [];
  let previewMean = 0;
  for (const delay of [0, 100, 300, 1e3, 2e3]) {
    const remaining = started + delay - Date.now();
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    const info = await page.evaluate(() => {
      const p = document.querySelector("hyperframes-player"), doc = p.iframeElement.contentDocument, time = doc.defaultView.__timelines.revline.time(), active = [...doc.querySelectorAll("video")].find((v) => time >= Number(v.dataset.start) && time < Number(v.dataset.end));
      return { elapsed: performance.now(), clock: time, player: p === window.original.player, document: doc === window.original.doc, retainedVideo: doc.contains(window.original.video), active: active ? { id: active.dataset.sourceClip, sourceStart: Number(active.dataset.mediaStart), sourceTime: active.currentTime, start: Number(active.dataset.start), ready: active.readyState, seeking: active.seeking } : null, clips: window.fixture.store.getState().timeline.clips.length, thumbnails: [...document.querySelectorAll(".timeline-clip")].map((c) => ({ id: c.dataset.clipId, images: c.querySelectorAll(".filmstrip-frame img").length, placeholders: c.querySelectorAll(".filmstrip-frame svg").length })), events: window.original.events, errors: window.errors };
    });
    const pixels = await sharp(await (await page.$("hyperframes-player")).screenshot()).resize(64, 36).removeAlpha().raw().toBuffer();
    previewMean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    checkpoints.push({ afterMs: Date.now() - started, previewMean, ...info });
  }
  const domProbe = await page.evaluate(() => {
    const d = document.querySelector("hyperframes-player").iframeElement.contentDocument;
    const paint = (c) => {
      const out = d.createElement("canvas");
      out.width = 64;
      out.height = 36;
      const ctx = out.getContext("2d");
      ctx.drawImage(c, 0, 0, 64, 36);
      const a = ctx.getImageData(0, 0, 64, 36).data;
      let total = 0;
      for (let i = 0; i < a.length; i += 4) total += a[i] + a[i + 1] + a[i + 2];
      return total / (64 * 36 * 3);
    };
    return { videos: [...d.querySelectorAll("video")].map((n) => ({ id: n.id, clip: n.dataset.sourceClip, start: n.dataset.start, end: n.dataset.end, currentTime: n.currentTime, ready: n.readyState, visibility: d.defaultView.getComputedStyle(n).visibility, z: n.closest(".visual-frame").style.zIndex })), canvases: [...d.querySelectorAll("canvas")].map((c) => ({ source: c.dataset.effectSource, width: c.width, height: c.height, mean: paint(c) })) };
  });
  const nativeDecodedMean = await page.evaluate(() => {
    const d = document.querySelector("hyperframes-player").iframeElement.contentDocument, t = d.defaultView.__timelines.revline.time(), v = [...d.querySelectorAll("video")].find((v2) => t >= Number(v2.dataset.start) && t < Number(v2.dataset.end)), c = d.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const x = c.getContext("2d");
    x.drawImage(v, 0, 0, 64, 36);
    const data = x.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return sum / (64 * 36 * 3);
  });
  const beforeForced = checkpoints.at(-1).previewMean;
  await page.evaluate(() => document.querySelector("hyperframes-player").iframeElement.contentWindow.__revlineEffects.redraw());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const forcedPixels = await sharp(await (await page.$("hyperframes-player")).screenshot()).resize(64, 36).removeAlpha().raw().toBuffer();
  const forceRedrawProbe = { nativeDecodedMean, before: beforeForced, after: forcedPixels.reduce((a, b) => a + b, 0) / forcedPixels.length };
  const seekStarted = Date.now(), seekCheckpoints = [];
  await page.evaluate(() => window.fixture.seek(8.2166667));
  for (const delay of [0, 100, 300, 1e3, 2e3, 4e3]) {
    const remaining = seekStarted + delay - Date.now();
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    const state = await page.evaluate(() => {
      const doc = document.querySelector("hyperframes-player").iframeElement.contentDocument, t = doc.defaultView.__timelines.revline.time(), v = [...doc.querySelectorAll("video")].find((v2) => t >= Number(v2.dataset.start) && t < Number(v2.dataset.end));
      return { clock: t, id: v?.dataset.sourceClip, sourceTime: v?.currentTime, ready: v?.readyState, seeking: v?.seeking };
    });
    const pixels = await sharp(await (await page.$("hyperframes-player")).screenshot()).resize(64, 36).removeAlpha().raw().toBuffer();
    seekCheckpoints.push({ afterMs: Date.now() - seekStarted, previewMean: pixels.reduce((a, b) => a + b, 0) / pixels.length, ...state });
  }
  await page.evaluate(() => window.fixture.seek(8.6));
  await page.waitForFunction(() => {
    const d = document.querySelector("hyperframes-player").iframeElement.contentDocument, v = d.querySelector("#clip-0");
    return !v.seeking && v.readyState >= 2;
  });
  await page.evaluate(() => window.fixture.play());
  await page.waitForFunction(() => window.fixture.store.getState().playing);
  await new Promise((r) => setTimeout(r, 150));
  const playingBefore = await page.evaluate(() => {
    const p = document.querySelector("hyperframes-player"), time = p.iframeElement.contentWindow.__timelines.revline.time();
    const state = window.fixture.store.getState(), target = state.timeline.clips.find((c) => time > c.start + 1e-6 && time < c.start + c.duration - 1e-6);
    state.edit(window.splitOwnedClip(state.timeline, target.id, time, "playing-tail"));
    return time;
  });
  await new Promise((r) => setTimeout(r, 250));
  // A new fragment may briefly hold the native player while it decodes (3544a5f holds playback during
  // video stalls); playback must still resume on the same player within a bounded wait.
  await page.waitForFunction((before) => { const p = document.querySelector("hyperframes-player"); return !p.paused && p.iframeElement.contentWindow.__timelines.revline.time() > before + 0.05; }, { timeout: 2000 }, playingBefore).catch(() => {});
  const playingProof = await page.evaluate(() => {
    const p = document.querySelector("hyperframes-player"), d = p.iframeElement.contentDocument, time = d.defaultView.__timelines.revline.time();
    return { clock: time, nativePaused: p.paused, playing: window.fixture.store.getState().playing, player: p === window.original.player, document: d === window.original.doc, retainedVideo: d.contains(window.original.video), events: window.original.events };
  });
  assert.equal(playingProof.playing, true, "Split while playing must preserve playback");
  assert.equal(playingProof.nativePaused, false, "The actual native player must remain playing");
  assert.ok(playingProof.clock > playingBefore + 0.05, "Playing split must preserve an advancing clock");
  assert.equal(playingProof.retainedVideo, true);
  assert.deepEqual(playingProof.events, { loadstart: 0, emptied: 0, contextlost: 0 });
  await page.evaluate(() => window.fixture.pause());
  await page.evaluate(() => {
    const p = document.querySelector("hyperframes-player"), seek = p.seek.bind(p);
    window.transportSeeks = 0;
    p.seek = (t) => {
      window.transportSeeks++;
      seek(t);
    };
    const state = window.fixture.store.getState(), time = p.iframeElement.contentWindow.__timelines.revline.time();
    state.edit({ ...state.timeline, clips: state.timeline.clips.map((c) => time >= c.start && time < c.start + c.duration ? { ...c, dither: { ...c.dither, levels: 3 } } : c) });
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.evaluate(() => window.transportSeeks), 0, "Effect-only edits must not seek the transport");
  await page.evaluate(() => {
    const state = window.fixture.store.getState();
    state.edit({ ...state.timeline, clips: [{ id: "still-clip", kind: "image", assetId: "still", track: 1, start: 2, duration: 1, sourceStart: 0 }] });
  });
  await page.evaluate(() => window.fixture.seek(2.5));
  await page.waitForFunction(() => {
    const d = document.querySelector("hyperframes-player").iframeElement.contentDocument;
    return d.querySelector("img")?.complete && d.querySelector("img").style.visibility === "visible";
  });
  const stillPixels = await sharp(await (await page.$("hyperframes-player")).screenshot()).resize(64, 36).removeAlpha().raw().toBuffer();
  assert.ok(stillPixels[0] > 200 && stillPixels[1] < 10 && stillPixels[2] > 200, "New image clip must activate on the retained player");
  await page.evaluate(() => window.fixture.seek(1.5));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const gapPixels = await sharp(await (await page.$("hyperframes-player")).screenshot()).resize(64, 36).removeAlpha().raw().toBuffer();
  assert.ok(gapPixels.reduce((a, b) => a + b, 0) / gapPixels.length < 1, "Image must hide in a timeline gap");
  await page.evaluate(() => {
    const state = window.fixture.store.getState();
    state.edit({ ...state.timeline, clips: [] });
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.evaluate(() => document.querySelector("hyperframes-player").iframeElement.contentDocument.querySelectorAll("[data-source-clip]").length), 0, "Deleting media must remove its retained layer");
  const proof = { playingProof, domProbe, forceRedrawProbe, seekCheckpoints, syntheticOnly: true, source: { width: 1920, height: 1080, duration: 20, fps: 30, gopFrames: 600 }, sourceRequestCount: requests.length, sourceRequestedBytes: requests.reduce((total, r) => total + r.end - r.start + 1, 0), requestsAfterSplits: requests.length - baselineRequests, checkpoints, consoleErrors: errors };
  await writeFile("/tmp/revline-preview-thin-split-proof.json", JSON.stringify(proof, null, 2), { mode: 384 });
  console.log(JSON.stringify({ first: proof.checkpoints[0], last: proof.checkpoints.at(-1), nativeDecodedMean, playingProof, sourceRequestCount: proof.sourceRequestCount, sourceRequestedBytes: proof.sourceRequestedBytes, requestsAfterSplits: proof.requestsAfterSplits }));
  const last = checkpoints.at(-1);
  assert.ok(seekCheckpoints.at(-1).previewMean > 25, "Seeking a new thin fragment leaves its preview black");
  assert.equal(last.player, true, "Split must retain player");
  assert.equal(last.document, true, "Split must retain iframe");
  assert.equal(last.retainedVideo, true, "Split must retain current decoder");
  assert.deepEqual(last.events, { loadstart: 0, emptied: 0, contextlost: 0 }, "Split must preserve existing decoder/GPU context");
  assert.ok(checkpoints[0].previewMean > 25, "Thin splits must retain the decoded preview immediately");
  assert.ok(last.previewMean > 25, "Preview remains black after sparse-keyframe thin splits");
  assert.ok(forceRedrawProbe.nativeDecodedMean > 25, "Actual decoded source must be nonblack");
  assert.equal(domProbe.videos.filter((v) => v.visibility === "visible" && v.clip !== last.active.id).length, 0, "Inactive split fragments must never cover the retained decoded clip");
  assert.ok(last.active && Math.abs(last.active.sourceTime - (last.active.sourceStart + last.clock - last.active.start)) < 0.1, "Native source must remain aligned with the split clip");
  assert.ok(last.thumbnails.filter((c) => c.placeholders > 0).length === 0, "Thin split thumbnails must not remain blank");
  assert.deepEqual(last.errors, []);
  assert.deepEqual(errors, []);
  console.log("PASS: actual high-resolution sparse-GOP Preview/Timeline rapid thin splits retain media and frames without blank preview or lingering placeholder thumbnails.");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
