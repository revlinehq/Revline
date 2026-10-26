import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{EditComposer}from'./components/workspace/edit-composer';import'./components/workspace/shared.css';
function Fixture(){const[files,setFiles]=useState(Array.from({length:8},(_,i)=>({id:String(i),name:'Long footage filename '+i+'.mp4',kind:'video'})));return <EditComposer variant="compact" value="" onChange={()=>{}} onSubmit={()=>{}} attachments={files} onRemoveAttachment={id=>setFiles(files.filter(f=>f.id!==id))}/>};createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, write: false, outdir: '/tmp/revline-attachment-layout', format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setContent('<html><style>*{box-sizing:border-box}body{margin:0;font:13px Arial}#root{width:340px;margin:20px}</style><div id="root"></div></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.css')).text });
  await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith('.js')).text });
  await page.waitForSelector('.composer-more');
  const contained = () => page.$eval('.edit-composer', form => {
    const box = form.getBoundingClientRect(), row = form.querySelector('.composer-attachments');
    return row.scrollWidth <= row.clientWidth + 1 && [...row.children].every(child => {
      const b = child.getBoundingClientRect(); return b.left >= box.left && b.right <= box.right;
    });
  });
  assert.ok(await contained(), 'Eight attachments must stay inside a narrow desktop composer');
  await page.click('.composer-more'); await page.waitForSelector('.composer-media-sheet');
  assert.equal(await page.$$eval('.composer-sheet-attachments .composer-attachment', nodes => nodes.length), 8);
  await page.click('[aria-label="Remove Long footage filename 7.mp4"]');
  assert.equal(await page.$$eval('.composer-sheet-attachments .composer-attachment', nodes => nodes.length), 7);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.composer-media-sheet'));
  await page.setViewport({ width: 320, height: 800 }); await page.addStyleTag({ content: '#root{width:280px}' });
  assert.ok(await contained(), 'Attachments must stay inside the mobile composer');
  console.log('PASS: narrow desktop/mobile attachments stay contained; all files and removal remain accessible.');
} finally { await browser.close(); }
