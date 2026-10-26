import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

const video = execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=s=128x72:r=30','-t','4','-threads','1','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
const source = 'data:video/mp4;base64,' + video.toString('base64');
const poster = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72"><rect width="128" height="72" fill="blue"/></svg>').toString('base64');
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
import{MediaFilmstrip}from'./components/editor/media-filmstrip';import{timelineThumbnailsPrepared}from'./lib/editor/editor-opening';
window.prepared=()=>timelineThumbnailsPrepared(document.getElementById('root'));
const asset={_id:'owned',kind:'video',fileName:'Local.mp4',width:128,height:72,duration:4,url:${JSON.stringify(source)},thumbnailUrl:${JSON.stringify(poster)}};
function Fixture(){const viewport=useRef(null);return <div className="timeline-scroll" ref={viewport}><MediaFilmstrip asset={asset} width={800} height={60} sourceStart={0} duration={4} timelineStart={0} px={200} fps={30} viewport={viewport}/></div>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-opening-thumbnails',define:{'process.env.NODE_ENV':'"production"'}});
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page = await browser.newPage();page.setDefaultTimeout(8000);
  await page.setViewport({width:900,height:200});
  await page.setContent('<div id="root"></div><style>*{box-sizing:border-box}.timeline-scroll{width:800px;height:80px;overflow:auto}.media-filmstrip{position:relative;width:800px;height:60px}.filmstrip-frame{position:absolute;top:0;height:60px}.filmstrip-frame img{width:100%;height:100%}</style>');
  await page.evaluate(() => {
    const create = document.createElement.bind(document), src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    const held = [];window.releaseThumbnails=()=>{for(const [video,url]of held){src.set.call(video,url);video.load();}};
    document.createElement = function(kind,...args){const element=create(kind,...args);if(kind==='video')Object.defineProperty(element,'src',{get(){return src.get.call(this);},set(url){held.push([this,url]);}});return element;};
  });
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.filmstrip-frame img')];return images.length>1&&images.every(image=>image.complete&&image.naturalWidth>0);});
  assert.equal(await page.evaluate(()=>window.prepared()),true,'Loaded poster fallbacks allow editing while exact thumbnails refine');
  await page.evaluate(()=>window.releaseThumbnails());
  await page.waitForFunction(()=>[...document.querySelectorAll('.filmstrip-frame img')].every(image=>image.dataset.thumbnailExact==='true'));
  await page.waitForFunction(()=>window.prepared());
  assert.equal(await page.$$eval('.filmstrip-frame img',images=>images.every(image=>image.dataset.thumbnailExact==='true'&&image.complete&&image.naturalWidth>0)),true,'Opening requires the actual requested source samples');
  await page.evaluate(()=>{for(const image of document.querySelectorAll('.filmstrip-frame img'))image.remove();});
  assert.equal(await page.evaluate(()=>window.prepared()),false,'Missing stills remain pending before a terminal decode result');
  await page.evaluate(()=>document.querySelector('.media-filmstrip').dataset.thumbnailState='failed');
  assert.equal(await page.evaluate(()=>window.prepared()),true,'Failed optional stills cannot permanently lock a playable edit');
  console.log('PASS: loaded poster fallbacks open the timeline; exact samples refine, and terminal thumbnail failure releases the optional opening gate. Local media only.');
} finally { await browser.close(); }
