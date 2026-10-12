import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {loadEnvConfig} from '@next/env';
import {ConvexHttpClient} from 'convex/browser';
import {getInstalledBrowsers} from '@puppeteer/browsers';
import puppeteer from 'puppeteer-core';
import {api} from '../convex/_generated/api';
import type {Id} from '../convex/_generated/dataModel';
loadEnvConfig(process.cwd(),true);
const origin=process.env.REVLINE_TEST_ORIGIN||'http://localhost:3001';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'));
assert.match(process.env.CONVEX_DEPLOYMENT||'',/^dev:/);
function clerk<T>(path:string,method='GET',body?:unknown):T{
const args=['-y','clerk@latest','api',path,'--app','app_3IhaKL6Wz1vzw3QGkUusb094tcX','--instance','dev','-X',method];if(body!==undefined)args.push('-d',JSON.stringify(body));
if(method!=='GET')execFileSync('npx',[...args,'--dry-run'],{stdio:['ignore','pipe','pipe']});
return JSON.parse(execFileSync('npx',[...args,'--yes'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})) as T;
}
async function main(){
let userId:string|undefined,projectId:Id<'projects'>|undefined,browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;const convex=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!,{logger:false});
try{
userId=clerk<{id:string}>('/users','POST',{email_address:[`revline-nav-${Date.now()}+clerk_test@example.com`],skip_password_requirement:true,first_name:'Navbar fixture'}).id;
const session=clerk<{id:string}>('/sessions','POST',{user_id:userId}).id;
convex.setAuth(clerk<{jwt:string}>(`/sessions/${session}/tokens/convex`,'POST',{}).jwt);
projectId=await convex.mutation(api.projects.create,{title:'Disposable navbar proof',aspectRatio:'vertical'});
const ticket=clerk<{token:string}>('/sign_in_tokens','POST',{user_id:userId,expires_in_seconds:120}).token;
const installed=await getInstalledBrowsers({cacheDir:process.env.PUPPETEER_CACHE_DIR||join(homedir(),'.cache/puppeteer')});const chrome=installed.find(b=>b.browser==='chrome');assert.ok(chrome);
browser=await puppeteer.launch({executablePath:chrome.executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto(origin+'/editor/demo',{waitUntil:'networkidle2',timeout:60000});
await page.waitForFunction(()=>!!(window as unknown as {Clerk?:{loaded?:boolean}}).Clerk?.loaded);
const signedIn=await page.evaluate(async ticket=>{
const clerk=(window as unknown as {Clerk:{client:{signIn:{create:(args:unknown)=>Promise<{status:string;createdSessionId:string}>}};setActive:(args:unknown)=>Promise<void>}}).Clerk;
const result=await clerk.client.signIn.create({strategy:'ticket',ticket});if(result.status!=='complete')return false;await clerk.setActive({session:result.createdSessionId});return true;
},ticket);assert.equal(signedIn,true);
await page.goto(`${origin}/editor/${projectId}`,{waitUntil:'networkidle2',timeout:60000});await page.waitForSelector('.editor-nav-account .cl-userButtonTrigger');
const dimensions=await page.$eval('.editor-nav-account .cl-avatarBox',el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));assert.deepEqual(dimensions,{width:28,height:28});
await page.click('.editor-nav-account .cl-userButtonTrigger');await page.waitForSelector('.cl-userButtonPopoverCard');assert.ok(await page.$eval('.cl-userButtonPopoverCard',el=>el.textContent?.includes('Navbar fixture')));
await page.keyboard.press('Escape');await page.waitForSelector('.cl-userButtonPopoverCard',{hidden:true});
await page.click('[aria-label="Project menu"]');await page.$$eval('[role=menuitem]',els=>(els.find(e=>e.textContent?.includes('Rename project')) as HTMLElement).click());await page.waitForSelector('[aria-label="Project title"]');await page.type('[aria-label="Project title"]','Renamed navbar fixture');await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.editor-nav-save')?.getAttribute('aria-label')==='All changes saved');
await new Promise(resolve=>setTimeout(resolve,800));assert.equal((await convex.query(api.projects.get,{projectId})).title,'Renamed navbar fixture');
console.log('Signed-in navbar passed: real Clerk dev sign-in, 28px user avatar and account popover, owned project rename persisted to Convex; disposable fixtures removed.');
}finally{
await browser?.close();if(projectId)await convex.mutation(api.projects.remove,{projectId});if(userId)clerk(`/users/${userId}`,'DELETE');
}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
