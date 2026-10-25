import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Adds two Audio FX packs to lib/editor/stock-audio-catalog.json, replacing only their own entries:
//  - "Freesound CC0": the CC0 Freesound cuts (sfx-29..sfx-61) from the video-edit skill's sfx folder,
//    checked against that folder's catalog (licence, rights status, source URL, SHA-256) and
//    transcoded to Ogg Opus. sfx-01..sfx-28 have unverified rights and are never imported.
//  - "Revline designed": pop, whoosh, tick, chime and thud, synthesized here from deterministic noise and sines.
// Usage: node scripts/author-library-audio.mjs --freesound ~/.claude/cstack/skills/video-edit/assets/sfx
//
// The designed sounds port pop(), whoosh(), tick(), chime(), thud() and the dsp helpers they use from
// cstack's skills/animated-video/templates/parts/audio/designed.py (https://github.com/goodnight000/cstack):
//   MIT License. Copyright (c) 2026 Charles Zheng. Permission is hereby granted, free of charge, to any person
//   obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
//   subject to the following conditions: The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
//   KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
//   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
//   IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// The rendered sounds contain no samples and are dedicated to CC0 like the Revline originals.

const args=process.argv.slice(2),freesound=args.includes('--freesound')?args[args.indexOf('--freesound')+1]:undefined;
if(!freesound)throw new Error('Pass --freesound <video-edit assets/sfx folder>.');
const SR=48000,TAU=2*Math.PI,PACKS=['Freesound CC0','Revline designed'];

// Curated names and Audio FX categories. Ids get an fs- prefix: whoosh-fast/whoosh-deep already name Revline originals.
const FREESOUND={
 'sfx-29':['Bubble burst','Textures'],'sfx-30':['Water plunge','Textures'],'sfx-31':['Wooden creak','Textures'],
 'sfx-32':['Lock clunk','Clicks'],'sfx-33':['Padlock click','Clicks'],'sfx-34':['Vault clank','Hits'],
 'sfx-35':['Servo motor','Textures'],'sfx-36':['Blade slice','Whooshes'],'sfx-37':['Phone buzz','Textures'],
 'sfx-38':['Screen tap','Clicks'],'sfx-39':['Clock ticking','Textures'],'sfx-40':['Card riffle','Textures'],
 'sfx-41':['Glass ting','Pops & tones'],'sfx-42':['Electric zap','Transitions'],'sfx-43':['Spark crackle','Textures'],
 'sfx-44':['Switch clack','Clicks'],'sfx-45':['Wing flutter','Textures'],'sfx-46':['Quick swish','Whooshes'],
 'sfx-47':['Low rumble whoosh','Whooshes'],'sfx-48':['Deep boom','Hits'],'sfx-49':['Camera shutter','Clicks'],
 'sfx-50':['Sonar ping','Pops & tones'],'sfx-51':['Distant foghorn','Pops & tones'],'sfx-52':['Rope pulley','Textures'],
 'sfx-53':['Tiles falling','Textures'],'sfx-54':['Soft pop','Pops & tones'],'sfx-55':['Rubber stamp','Hits'],
 'sfx-56':['Underwater bed','Ambience'],'sfx-57':['City night bed','Ambience'],'sfx-58':['Server room bed','Ambience'],
 'sfx-59':['Hull water bed','Ambience'],'sfx-60':['Electrical hum bed','Ambience'],'sfx-61':['Radio static bed','Ambience'],
};

// ---- dsp (ported from designed.py / dsp.py; stereo signals are [left, right] Float64Arrays) ----
const secs=d=>Float64Array.from({length:Math.round(d*SR)},(_,i)=>i/SR);
function noise(n,seed){let s=(seed*2654435761)>>>0||1;const u=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return (s+.5)/4294967296;};
 const out=new Float64Array(n);for(let i=0;i<n;i++)out[i]=Math.sqrt(-2*Math.log(u()))*Math.cos(TAU*u());return out;}
// Second-order Butterworth sections (bilinear transform with prewarping, as scipy's butter(2, ...)).
function biquad(x,fc,kind){fc=Math.min(Math.max(fc,12),SR*.47);const w=TAU*fc/SR,c=Math.cos(w),a=Math.sin(w)/(2*Math.SQRT1_2),a0=1+a;
 const b=kind==='low'?[(1-c)/2,1-c,(1-c)/2]:[(1+c)/2,-(1+c),(1+c)/2],a1=-2*c/a0,a2=(1-a)/a0,[b0,b1,b2]=b.map(v=>v/a0);
 const y=new Float64Array(x.length);let x1=0,x2=0,y1=0,y2=0;for(let i=0;i<x.length;i++){const v=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=x[i];y2=y1;y1=v;y[i]=v;}return y;}
const lp=(x,fc)=>biquad(x,fc,'low'),hp=(x,fc)=>biquad(x,fc,'high'),bp=(x,lo,hi)=>lp(hp(x,lo),hi);
const each=(x,f)=>Float64Array.from(x,f);
function fade(x,a=.005,r=.02){x=Float64Array.from(x);const na=Math.min(x.length,Math.trunc(a*SR)),nr=Math.min(x.length,Math.trunc(r*SR)),ramp=(i,n)=>.5-.5*Math.cos(Math.PI*(n>1?i/(n-1):0));
 for(let i=0;i<na;i++)x[i]*=ramp(i,na);for(let i=0;i<nr;i++)x[x.length-1-i]*=ramp(i,nr);return x;}
const soft=(x,drive=1)=>each(x,v=>Math.tanh(v*drive)/Math.tanh(drive));
function stereo(m,p=0){const a=(Math.min(Math.max(p,-1),1)+1)*Math.PI/4;return [each(m,v=>v*Math.cos(a)),each(m,v=>v*Math.sin(a))];}
const gain=(s,g)=>s.map(c=>each(c,v=>v*g));
function sweep(f0,f1,dur,shape=1){const t=secs(dur),ph=new Float64Array(t.length);let acc=0;for(let i=0;i<t.length;i++){acc+=f0*(f1/f0)**((t[i]/dur)**shape);ph[i]=TAU*acc/SR;}return {ph,t};}
function fft(re,im,inverse){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const ang=(inverse?TAU:-TAU)/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const a=i+k,b=a+len/2,tr=re[b]*cr-im[b]*ci,ti=re[b]*ci+im[b]*cr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;[cr,ci]=[cr*wr-ci*wi,cr*wi+ci*wr];}}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}}
function convolve(x,h){let n=1;while(n<x.length+h.length-1)n<<=1;const ar=new Float64Array(n),ai=new Float64Array(n),br=new Float64Array(n),bi=new Float64Array(n);ar.set(x);br.set(h);fft(ar,ai);fft(br,bi);
 for(let i=0;i<n;i++){const r=ar[i]*br[i]-ai[i]*bi[i];ai[i]=ar[i]*bi[i]+ai[i]*br[i];ar[i]=r;}fft(ar,ai,true);return ar.subarray(0,x.length+h.length-1);}
/** Convolution reverb with a synthetic impulse: decaying, low-passed, decorrelated noise. */
function reverb(x,{decay=3,wet=.3,bright=5000,seed=7,pre=.02,dry=1}={}){const n=Math.trunc(decay*1.6*SR),ramp=Math.trunc(.004*SR);
 const ir=[seed,seed+1].map(s=>{const y=lp(each(noise(n,s),(v,i)=>v*Math.exp(-6.9*i/SR/decay)),bright);for(let i=0;i<ramp;i++)y[i]*=i/(ramp-1);return y;});
 const norm=ir.reduce((sum,c)=>sum+Math.sqrt(c.reduce((e,v)=>e+v*v,0)),0)/2,offset=Math.trunc(pre*SR);
 return x.map((c,ch)=>{const out=new Float64Array(c.length+n+offset),tail=convolve(c,ir[ch]);for(let i=0;i<c.length;i++)out[i]+=c[i]*dry;for(let i=0;i<tail.length;i++)out[offset+i]+=tail[i]/norm*wet;return out;});}

// ---- designed sounds ----
function pop(f=520){const {ph,t}=sweep(f*1.9,f,.05,.5);return gain(stereo(fade(each(ph,(p,i)=>Math.sin(p)*Math.exp(-t[i]/.018)),.001,.01)),.6);}
function thud(f=70,dur=.5){const head=sweep(f*2.6,f,.06),t=secs(dur),ph=new Float64Array(t.length);ph.set(head.ph);for(let i=head.ph.length;i<t.length;i++)ph[i]=head.ph.at(-1)+TAU*f*(i-head.ph.length)/SR;
 const click=hp(lp(noise(t.length,12),3000),500);return stereo(fade(soft(each(ph,(p,i)=>(Math.sin(p)+.35*Math.sin(2*p))*Math.exp(-t[i]/.11)+click[i]*Math.exp(-t[i]/.012)*.5),1.3),.001,.05));}
function whoosh(dur=.6,lo=300,hi=5000,pan0=-.7,pan1=.7,seed=3,peak=.55){const n=Math.trunc(dur*SR),src=noise(n,seed),mids=[0,1,2,3].map(i=>lo*(hi/lo)**(i/3)),bands=mids.map(m=>bp(src,m*.6,m*1.6));
 const left=new Float64Array(n),right=new Float64Array(n);for(let i=0;i<n;i++){const x=i/SR/dur,env=Math.sin(Math.PI*Math.min(Math.max(x,0),1))**2*Math.exp(-Math.max(0,x-peak)*2.5),pos=Math.sin(Math.PI*x)*3;
  const y=bands.reduce((sum,band,k)=>sum+band[i]*Math.min(Math.max(1-Math.abs(pos-k),0),1),0),a=(pan0+(pan1-pan0)*x+1)*Math.PI/4;left[i]=y*env*Math.cos(a);right[i]=y*env*Math.sin(a);}
 return [fade(left,.01,.03),fade(right,.01,.03)];}
function tick(pitch=1){const t=secs(.09),hiss=hp(noise(t.length,13),3000);
 const y=each(t,(s,i)=>Math.sin(TAU*2100*pitch*s)*Math.exp(-s/.006)+.6*Math.sin(TAU*820*pitch*s)*Math.exp(-s/.014)+hiss[i]*Math.exp(-s/.002)*.5);
 return reverb(gain(stereo(fade(y,.0005,.01)),.7),{decay:.5,wet:.12,bright:5000});}
function chime(f=523.25,dur=3){const t=secs(dur),partials=[[1,1,1],[2,.45,.6],[2.76,.3,.45],[5.4,.16,.25]].filter(([r])=>f*r<SR/2.2);
 const y=each(t,s=>partials.reduce((sum,[r,a,d])=>sum+a*Math.sin(TAU*f*r*s)*Math.exp(-s/(dur*.25*d)),0));
 return reverb(gain(stereo(fade(y,.002,.2)),.6),{decay:2.6,wet:.35,bright:6000});}
const DESIGNED=[
 {id:'synth-pop',name:'Synth pop',category:'Pops & tones',tags:['pop','ui','appear'],render:()=>pop()},
 {id:'synth-whoosh',name:'Panning whoosh',category:'Whooshes',tags:['whoosh','transition','swoosh'],render:()=>whoosh()},
 {id:'synth-tick',name:'Single tick',category:'Clicks',tags:['tick','clock','ui'],render:()=>tick()},
 {id:'synth-chime',name:'Soft chime',category:'Pops & tones',tags:['chime','bell','tone','success'],render:()=>chime()},
 {id:'synth-thud',name:'Soft thud',category:'Hits',tags:['thud','impact','land'],render:()=>thud(85)},
];

/** Peak to -3 dBFS like the Freesound cuts, drop the silent reverb tail below -60 dB and fade the new end. */
function finish([left,right]){let peak=0;for(const c of [left,right])for(const v of c)peak=Math.max(peak,Math.abs(v));
 const floor=peak*1e-3;let end=left.length;while(end>1&&Math.abs(left[end-1])<floor&&Math.abs(right[end-1])<floor)end--;
 const g=10**(-3/20)/peak,data=new Float32Array(end*2),out=fade(left.subarray(0,end),0,.01),outR=fade(right.subarray(0,end),0,.01);
 for(let i=0;i<end;i++){data[2*i]=out[i]*g;data[2*i+1]=outR[i]*g;}return data;}

async function encode(input,file,inputArgs=[]){execFileSync('ffmpeg',['-v','error','-y',...inputArgs,'-i',input,'-ar',String(SR),'-ac','2','-c:a','libopus','-b:a','128k','-map_metadata','-1','-fflags','+bitexact',file]);
 const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex'),mono=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar',String(SR),'-f','f32le','-'],{maxBuffer:64*1024*1024});
 const decoded=new Float32Array(mono.buffer,mono.byteOffset,mono.byteLength/4),peaks=Buffer.alloc(Math.ceil(decoded.length/480));
 for(let bucket=0;bucket<peaks.length;bucket++){let level=0;for(let i=bucket*480;i<Math.min(decoded.length,(bucket+1)*480);i++)level=Math.max(level,Math.abs(decoded[i]));peaks[bucket]=Math.min(255,Math.round(level*255));}
 const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{encoding:'utf8'}).trim());
 return {r2Key:'media/stock/audio-fx-v1/'+sha256,sha256,file,contentType:'audio/ogg',duration,size:bytes.length,waveform:{peaks:peaks.toString('base64'),samplesPerSecond:100}};}

const directory=await mkdtemp(join(tmpdir(),'revline-library-audio-'));
try{
 const manifest=JSON.parse(await readFile('lib/editor/stock-audio-catalog.json','utf8')).filter(sound=>!PACKS.includes(sound.pack));
 const source=JSON.parse(await readFile(join(freesound,'catalog.json'),'utf8'));
 for(const [id,[name,category]] of Object.entries(FREESOUND)){
  const entry=source.find(item=>item.id===id);
  if(!entry||entry.license!=='CC0 1.0'||entry.rights_status!=='cc0_freesound'||!/^https:\/\/freesound\.org\/people\/[^/]+\/sounds\/\d+\/$/.test(entry.source_url))throw new Error(id+' is not a verified CC0 Freesound effect.');
  const input=join(freesound,entry.file);if(createHash('sha256').update(await readFile(input)).digest('hex')!==entry.sha256)throw new Error(id+' bytes differ from the source catalog.');
  const stem=entry.file.replace(/\.flac$/,''),soundId=entry.source_url.match(/sounds\/(\d+)/)[1];
  const media=await encode(input,'assets/audio-fx/fs-'+stem+'.ogg');
  manifest.push({id:'fs-'+stem,name,category,tags:[...new Set([...entry.tags,'recorded'])],pack:'Freesound CC0',sourceFile:`freesound ${soundId} preview`+(entry.source_in==null?'':` ${entry.source_in.toFixed(3)}-${entry.source_out.toFixed(3)} s`),sourceUrl:entry.source_url,license:'CC0-1.0',creator:entry.creator,...media});
  console.log(name+': '+media.duration+'s, '+media.size+' bytes');
 }
 for(const spec of DESIGNED){
  const raw=join(directory,spec.id+'.f32');await writeFile(raw,Buffer.from(finish(spec.render()).buffer));
  const media=await encode(raw,'assets/audio-fx/'+spec.id+'.ogg',['-f','f32le','-ar',String(SR),'-ac','2']);
  manifest.push({id:spec.id,name:spec.name,category:spec.category,tags:[...spec.tags,'synth'],pack:'Revline designed',sourceFile:'scripts/author-library-audio.mjs#'+spec.id,sourceUrl:'https://creativecommons.org/publicdomain/zero/1.0/',license:'CC0-1.0',...media});
  console.log(spec.name+': '+media.duration+'s, '+media.size+' bytes');
 }
 await writeFile('lib/editor/stock-audio-catalog.json',JSON.stringify(manifest,null,2)+'\n');
}finally{await rm(directory,{recursive:true,force:true});}
