// Actual Preview + Timeline, local synthetic 720p video, no backend or paid APIs.
// PERF_MODES=baseline,stack,four-layers,dense; optional PERF_RUNTIME and PERF_PROOF.
// Software-WebGL timings are observational, not a hardware-GPU performance guarantee.
// Parent-frame intervals, decoded counters, and two-RAF seek settling are distinct metrics.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), "revline-preview-effects-perf-")), path = join(directory, "source.mp4");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-threads", "2", "-y", path]);
const fixture = await build({ stdin: { resolveDir: root, loader: "tsx", contents: `
import React,{useRef}from'react';import{createRoot}from'react-dom/client';import{Preview}from'./components/editor/preview';import{TimelinePanel}from'./components/editor/timeline';import{TooltipProvider}from'./components/ui/tooltip';import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';import{visualEffectsPatch}from'./lib/editor/visual-effects';import'./components/workspace/workspace-pages.css';import'./app/editor.css';
const mode=new URLSearchParams(location.search).get('mode')??'baseline',source={id:'video',kind:'video',assetId:'owned',track:1,start:0,duration:10,sourceStart:0,volume:0};
const look=visualEffectsPatch(source,{colorGrade:{enabled:true,contrast:1.1,saturation:.9},invert:{enabled:true,amount:.05},glitch:{enabled:true,intensity:.15,rgbSplit:5},filmOverlay:{enabled:true,amount:.15,grain:.3},neonEdges:{enabled:true,amount:.2},lensDistortion:{enabled:true,amount:.08,fringing:2},turbulentDisplace:{enabled:true,amount:4,speed:.5},frameCorners:{enabled:true,amount:.08}});
let clips=mode==='baseline'?[source]:mode==='stack'?[{...source,...look}]:mode==='four-layers'?Array.from({length:4},(_,i)=>({...source,...look,id:'layer-'+i,track:i+1,transform:{x:[.35,.65,.35,.65][i],y:[.35,.35,.65,.65][i],scale:.6,rotation:0,opacity:1}})):Array.from({length:40},(_,i)=>({...source,...look,id:'split-'+i,start:i*.25,duration:.25,sourceStart:i*.25}));
if(mode==='four-layers')clips.push(...Array.from({length:4},(_,i)=>({id:'blur-'+i,kind:'effect',effectPreset:'zoom-blur',track:i+1,start:0,duration:10,sourceStart:0,zoomBlur:{enabled:true,amount:.08,centerX:.5,centerY:.5}})));
if(mode==='dense')clips.push(...Array.from({length:40},(_,i)=>({id:'blur-'+i,kind:'effect',effectPreset:'zoom-blur',track:1,start:i*.25,duration:.25,sourceStart:0,zoomBlur:{enabled:true,amount:.1,centerX:.5,centerY:.5}})));
const store=createEditorStore({fps:30,aspectRatio:'landscape',clips}),assets=[{_id:'owned',kind:'video',width:1280,height:720,duration:12,fileName:'Synthetic moving footage.mp4',url:location.origin+'/source.mp4',hasAudio:false}];window.errors=[];
function Fixture(){const ref=useRef(null),timeline=useEditorState(s=>s.timeline),playing=useEditorState(s=>s.playing),selected=useEditorState(s=>s.selectedId);window.fixture={store,mode,seek:t=>ref.current.seek(t),play:()=>ref.current.play(),pause:()=>ref.current.pause()};return <TooltipProvider><div className="editor-app conversation-editor"><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onSelectClip={id=>store.setState({selectedId:id})} onClipChange={()=>{}} onTime={t=>store.setState({playhead:t})} onPlaying={playing=>store.setState({playing})} onError={e=>window.errors.push(e)}/><TimelinePanel timeline={timeline} assets={assets} selected={selected} onSelect={id=>store.setState({selectedId:id,selectedIds:id?[id]:[]})} time={0} playing={playing} readPlaybackTime={()=>ref.current?.currentTime()??0} onSeek={t=>ref.current.seek(t)} onChange={t=>store.getState().edit(t)} onSplit={()=>{}} onDelete={()=>{}} onDuplicate={()=>{}} onAddText={()=>{}}/></div></TooltipProvider>}createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
` }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, outdir: "/tmp/revline-stress-fixture", define: { "process.env.NODE_ENV": '"production"' } });
const runtime = await build({ entryPoints: ["lib/editor/visual-effects-runtime.ts"], bundle: true, minify: true, write: false, platform: "browser", format: "iife", globalName: "__revlineVisualEffects" });
const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, "http://fixture").pathname;
    const body = p === "/fixture.js" ? fixture.outputFiles.find((f) => f.path.endsWith(".js")).text : p === "/fixture.css" ? fixture.outputFiles.find((f) => f.path.endsWith(".css")).text : p === "/source.mp4" ? await readFile(path) : p === "/vendor/visual-effects.js" ? process.env.PERF_RUNTIME ? await readFile(process.env.PERF_RUNTIME) : runtime.outputFiles[0].text : p === "/" ? '<html data-workspace-theme="dark"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font:12px Arial}.editor-app{height:1000px}.preview-canvas{position:relative;width:960px!important;height:540px!important;max-width:none!important}.preview-area{height:570px;flex:none}.hyperframes-host{position:absolute;inset:0}.custom-timeline{height:360px}</style><div id="root"></div><script src="/fixture.js"><\/script>' : await readFile(root + "/public" + p);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body), range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    res.setHeader("Content-Type", p.endsWith(".mp4") ? "video/mp4" : p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".woff2") ? "font/woff2" : "text/html");
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : buf.length - 1;
      res.writeHead(206, { "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${buf.length}`, "Content-Length": b - a + 1 });
      res.end(buf.subarray(a, b + 1));
    } else res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--js-flags=--max-old-space-size=1536"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), results = [];
const percentile = (a, p) => [...a].sort((a2, b) => a2 - b)[Math.floor(a.length * p)] ?? 0;
try {
  for (const mode of (process.env.PERF_MODES ?? "baseline,stack,four-layers,dense").split(",")) {
    const page = await browser.newPage(), runtimeErrors = [];
    page.on("pageerror", (e) => runtimeErrors.push(e.message));
    await page.setViewport({ width: 1440, height: 1e3 });
    await page.evaluateOnNewDocument(() => {
      window.glStats = { draw: 0, upload: 0, compile: 0, status: 0, drawMs: 0, uploadMs: 0, statusMs: 0 };
      for (const name of ["drawArrays", "texImage2D", "compileShader", "checkFramebufferStatus"]) {
        const original = WebGLRenderingContext.prototype[name];
        WebGLRenderingContext.prototype[name] = function(...args) {
          const key = { drawArrays: "draw", texImage2D: "upload", compileShader: "compile", checkFramebufferStatus: "status" }[name], t = performance.now();
          window.glStats[key]++;
          const result = original.apply(this, args);
          if (key !== "compile") window.glStats[key + "Ms"] += performance.now() - t;
          return result;
        };
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    await page.waitForFunction(() => document.querySelector("hyperframes-player")?.style.zIndex === "1", { timeout: 3e4 });
    await page.evaluate(() => window.fixture.seek(0.1));
    await wait(800);
    const cdp = await page.createCDPSession();
    const snapshot = () => page.evaluate(() => {
      const player = document.querySelector("hyperframes-player"), w = player.iframeElement.contentWindow, d = w.document;
      return { time: w.__timelines.revline.time(), stats: { ...w.glStats }, videos: [...d.querySelectorAll("video")].filter((v) => !v.paused).map((v) => ({ id: v.id, time: v.currentTime, start: v.dataset.start, duration: v.dataset.duration, ready: v.readyState, seeking: v.seeking, visible: getComputedStyle(v).display })), canvases: [...d.querySelectorAll("canvas.visual-effect-output")].map((c) => ({ w: c.width, h: c.height })), quality: [...d.querySelectorAll("video")].map((v) => v.getVideoPlaybackQuality()).reduce((r, q) => ({ total: r.total + q.totalVideoFrames, dropped: r.dropped + q.droppedVideoFrames }), { total: 0, dropped: 0 }), errors: window.errors, clips: window.fixture.store.getState().timeline.clips.length };
    });
    const beforeIdle = await page.metrics(), idleStart = await snapshot();
    await wait(900);
    const afterIdle = await page.metrics(), idleEnd = await snapshot();
    await page.evaluate(() => {
      window.samples = [];
      window.longTasks = [];
      window.watch = true;
      window.observer = new PerformanceObserver((list) => window.longTasks.push(...list.getEntries().map((e) => e.duration)));
      window.observer.observe({ type: "longtask" });
      function tick(t) {
        window.samples.push(t);
        if (window.watch) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      window.fixture.play();
    });
    await wait(500);
    const playStart = await snapshot(), metricsStart = await page.metrics();
    await page.evaluate(() => window.samples = []);
    await wait(3e3);
    const metricsEnd = await page.metrics(), playEnd = await snapshot();
    const frames = await page.evaluate(() => {
      window.watch = false;
      window.fixture.pause();
      window.observer.disconnect();
      return { samples: window.samples, tasks: window.longTasks };
    });
    await wait(250);
    const seekTimes = [];
    for (let i = 0; i < 20; i++) {
      const elapsed = await page.evaluate(async (t) => {
        const start = performance.now();
        window.fixture.seek(t);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - start;
      }, 0.1 + i * 0.44);
      seekTimes.push(elapsed);
    }
    const final = await snapshot(), gpu = await page.evaluate(() => {
      const w = document.querySelector("hyperframes-player").iframeElement.contentWindow, c = w.document.querySelector(".visual-effect-output");
      if (!c) return null;
      const gl = c.getContext("webgl"), ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }), dom = await cdp.send("Memory.getDOMCounters");
    const intervals = frames.samples.slice(1).map((t, i) => t - frames.samples[i]);
    results.push({ mode, resolution: { source: "1280\xD7720@30", composition: "1920\xD71080", preview: "960\xD7540", gpu }, initial: idleStart, paused: { taskMs: (afterIdle.TaskDuration - beforeIdle.TaskDuration) * 1e3, scriptMs: (afterIdle.ScriptDuration - beforeIdle.ScriptDuration) * 1e3, draws: idleEnd.stats.draw - idleStart.stats.draw }, playback: { activeVideos: playEnd.videos, clockProgress: playEnd.time - playStart.time, frameCount: frames.samples.length, p95: percentile(intervals, 0.95), max: Math.max(...intervals), framesOver34: intervals.filter((t) => t > 34).length, longTasks: frames.tasks, taskMs: (metricsEnd.TaskDuration - metricsStart.TaskDuration) * 1e3, scriptMs: (metricsEnd.ScriptDuration - metricsStart.ScriptDuration) * 1e3, layouts: metricsEnd.LayoutCount - metricsStart.LayoutCount, draws: playEnd.stats.draw - playStart.stats.draw, uploads: playEnd.stats.upload - playStart.stats.upload, compiles: playEnd.stats.compile - playStart.stats.compile, glTimeMs: { draw: playEnd.stats.drawMs - playStart.stats.drawMs, upload: playEnd.stats.uploadMs - playStart.stats.uploadMs, status: playEnd.stats.statusMs - playStart.stats.statusMs }, quality: { total: playEnd.quality.total - playStart.quality.total, dropped: playEnd.quality.dropped - playStart.quality.dropped } }, scrub: { p95: percentile(seekTimes, 0.95), max: Math.max(...seekTimes) }, heapMB: metricsEnd.JSHeapUsedSize / 1e6, dom, final, runtimeErrors });
    console.log(JSON.stringify(results.at(-1)));
    assert.deepEqual(runtimeErrors, [], "The real Preview has no uncaught errors");
    assert.deepEqual(final.errors, [], "The compositor reports no errors");
    assert.equal(idleEnd.stats.draw - idleStart.stats.draw, 0, "Paused effects stop drawing");
    assert.ok(playEnd.videos.length > 0 && playEnd.videos.length <= (mode === "four-layers" ? 4 : 1), "Only active footage plays");
    assert.ok(playEnd.videos.every(video => playEnd.time >= Number(video.start) - 1 / 30 && playEnd.time < Number(video.start) + Number(video.duration) + 1 / 30), "Playing decoders belong to the current timeline interval");
    await writeFile(process.env.PERF_PROOF ?? "/tmp/revline-preview-effects-performance.json", JSON.stringify(results, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
