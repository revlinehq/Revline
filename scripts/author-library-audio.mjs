import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderPreset} from '../lib/audio/presets';
import {fade} from '../lib/audio/dsp';

// Adds two Audio FX packs to lib/editor/stock-audio-catalog.json, replacing only their own entries:
//  - "Freesound CC0": the CC0 Freesound cuts (sfx-29..sfx-61) from the video-edit skill's sfx folder,
//    checked against that folder's catalog (licence, rights status, source URL, SHA-256) and
//    transcoded to Ogg Opus. sfx-01..sfx-28 have unverified rights and are never imported.
//  - "Revline designed": pop, whoosh, tick, chime and thud, rendered by the presets in lib/audio/presets.ts.
// Usage: node --import tsx scripts/author-library-audio.mjs --freesound ~/.claude/cstack/skills/video-edit/assets/sfx
//
// lib/audio/dsp.ts and lib/audio/presets.ts port those functions and the dsp helpers they use from
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
const SR=48000,PACKS=['Freesound CC0','Revline designed'];

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

const DESIGNED=[
 {id:'synth-pop',name:'Synth pop',category:'Pops & tones',tags:['pop','ui','appear'],render:()=>renderPreset('pop')},
 {id:'synth-whoosh',name:'Panning whoosh',category:'Whooshes',tags:['whoosh','transition','swoosh'],render:()=>renderPreset('whoosh')},
 {id:'synth-tick',name:'Single tick',category:'Clicks',tags:['tick','clock','ui'],render:()=>renderPreset('tick')},
 {id:'synth-chime',name:'Soft chime',category:'Pops & tones',tags:['chime','bell','tone','success'],render:()=>renderPreset('chime',{note:523.25})},
 {id:'synth-thud',name:'Soft thud',category:'Hits',tags:['thud','impact','land'],render:()=>renderPreset('thud',{frequency:85})},
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
