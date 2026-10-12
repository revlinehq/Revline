import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:730,height:900});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});
 await page.waitForSelector('.timeline-clip');
 const divider=await page.$eval('[aria-label="Resize preview and timeline"]',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.move(divider.x,divider.y);await page.mouse.down();await page.mouse.move(divider.x,divider.y+160,{steps:10});await page.mouse.up();await pause(150);
 const original=await page.evaluate(()=>document.querySelectorAll('.timeline-clip').length);
 await page.$eval('.timeline-scroll',e=>{e.scrollTop=10000;e.scrollLeft=100;});await pause(100);
 const scrolled=await page.evaluate(()=>({scrollTop:document.querySelector('.timeline-scroll').scrollTop,labelScroll:document.querySelector('.track-headers').scrollTop,rows:[...document.querySelectorAll('.timeline-track')].map((e,i)=>({bottom:e.getBoundingClientRect().bottom,labelBottom:document.querySelectorAll('.track-label')[i].getBoundingClientRect().bottom}))}));
 console.log('SCROLLED',JSON.stringify(scrolled));
 for(const row of scrolled.rows)assert.ok(Math.abs(row.bottom-row.labelBottom)<1,'Horizontal divider must remain aligned across the track rail while scrolling');
 assert.equal((await page.$$('.timeline-clip')).length,original);
 const edges=await page.evaluate(()=>{const panel=document.querySelector('.timeline-panel').getBoundingClientRect(),rail=document.querySelector('.track-headers').getBoundingClientRect(),viewport=document.querySelector('.timeline-scroll').getBoundingClientRect(),row=document.querySelector('.timeline-track').getBoundingClientRect();return {panelLeft:panel.left,railLeft:rail.left,panelRight:panel.right,viewportRight:viewport.right,rowRight:row.right};});
 assert.equal(edges.panelLeft,edges.railLeft,'Divider is inset from the left edge');
 assert.equal(edges.panelRight,edges.viewportRight,'Divider is inset from the right edge');
 assert.ok(edges.rowRight>=edges.viewportRight-10,'Lane divider ends before the visible timeline edge');
 await page.setViewport({width:1440,height:1000});await pause(150);
 await page.screenshot({path:'design/implementation/timeline-b-fixed.png'});
 console.log(JSON.stringify({passed:true,scrolledDividersAligned:true,edges}));
}finally{await browser.close();}
