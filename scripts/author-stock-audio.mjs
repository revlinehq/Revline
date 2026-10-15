import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Original deterministic DSP: shaped, moving-band noise with quiet ascending tonal layers.
// No sampled source, model, external sound, or third-party synthesis code is used.
const specs=[
 {id:'whoosh-light',name:'Light whoosh',category:'Whooshes',duration:.48,low:700,high:6200,tone:140,seed:11},
 {id:'whoosh-fast',name:'Fast whoosh',category:'Whooshes',duration:.32,low:450,high:4800,tone:220,seed:29},
 {id:'whoosh-air',name:'Air whoosh',category:'Whooshes',duration:.95,low:1300,high:8500,tone:0,seed:47},
 {id:'whoosh-deep',name:'Deep whoosh',category:'Whooshes',duration:1.15,low:100,high:2100,tone:55,seed:83},
 {id:'riser-short',name:'Short riser',category:'Risers',duration:2,low:250,high:6200,tone:100,seed:101},
 {id:'riser-air',name:'Air riser',category:'Risers',duration:2.5,low:900,high:7600,tone:0,seed:131},
 {id:'riser-tonal',name:'Tonal riser',category:'Risers',duration:3,low:300,high:4400,tone:90,seed:163},
 {id:'riser-deep',name:'Deep riser',category:'Risers',duration:4,low:90,high:3300,tone:40,seed:197},
];
const directory=await mkdtemp(join(tmpdir(),'revline-authored-audio-'));
try{
 const manifest=JSON.parse(await readFile('lib/editor/stock-audio-catalog.json','utf8')).filter(sound=>sound.pack!=='Revline originals');
 for(const spec of specs){
  const rate=48000,count=Math.round(spec.duration*rate),data=new Float32Array(count*2);let seed=spec.seed,phase=0,lowPass=0,slowPass=0,sidePass=0;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
  const rising=spec.category==='Risers';
  for(let i=0;i<count;i++){
   const u=i/(count-1),t=i/rate,position=rising?u:Math.sin(u*Math.PI/2),cutoff=spec.low*Math.pow(spec.high/spec.low,position),alpha=1-Math.exp(-2*Math.PI*cutoff/rate),hp=1-Math.exp(-2*Math.PI*(rising?110:70)/rate);
   lowPass+=alpha*(random()-lowPass);slowPass+=hp*(lowPass-slowPass);sidePass+=alpha*(random()-sidePass);
   const fade=Math.min(1,t/.012,(spec.duration-t)/.018),envelope=rising?Math.pow(u,.78)*(.92+.08*Math.sin(2*Math.PI*(2*t+1.5*t*t))):Math.pow(Math.sin(Math.PI*u),1.7);
   const frequency=spec.tone*Math.pow(rising?12:3,position);phase+=2*Math.PI*frequency/rate;
   const harmonic=spec.tone?(Math.sin(phase)+.22*Math.sin(2*phase)+.08*Math.sin(3*phase))*(rising?.055:.045):0;
   const center=(lowPass-slowPass)*.9+harmonic,side=sidePass*.12;
   data[2*i]=(center+side)*envelope*Math.max(0,fade);data[2*i+1]=(center-side)*envelope*Math.max(0,fade);
  }
  let peak=0,energy=0;for(const value of data){peak=Math.max(peak,Math.abs(value));energy+=value*value;}
  const rms=Math.sqrt(energy/data.length),gain=Math.min(.70/peak,.13/rms);for(let i=0;i<data.length;i++)data[i]*=gain;
  const raw=join(directory,'sound.f32'),file='assets/audio-fx/'+spec.id+'.ogg';await writeFile(raw,Buffer.from(data.buffer));
  execFileSync('ffmpeg',['-v','error','-y','-f','f32le','-ar',String(rate),'-ac','2','-i',raw,'-c:a','libvorbis','-q:a','6','-map_metadata','-1','-fflags','+bitexact',file]);
  const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex'),mono=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar',String(rate),'-f','f32le','-']);
  const decoded=new Float32Array(mono.buffer,mono.byteOffset,mono.byteLength/4),peaks=Buffer.alloc(Math.ceil(decoded.length/480));for(let bucket=0;bucket<peaks.length;bucket++){let level=0;for(let i=bucket*480;i<Math.min(decoded.length,(bucket+1)*480);i++)level=Math.max(level,Math.abs(decoded[i]));peaks[bucket]=Math.min(255,Math.round(level*255));}
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{encoding:'utf8'}).trim());
  manifest.push({id:spec.id,name:spec.name,category:spec.category,tags:[rising?'build':'swoosh','transition','original'],pack:'Revline originals',sourceFile:'scripts/author-stock-audio.mjs#'+spec.id,sourceUrl:'https://creativecommons.org/publicdomain/zero/1.0/',license:'CC0-1.0',r2Key:'media/stock/audio-fx-v1/'+sha256,sha256,file,contentType:'audio/ogg',duration,size:bytes.length,waveform:{peaks:peaks.toString('base64'),samplesPerSecond:100}});
  console.log(spec.name+': '+duration+'s, '+bytes.length+' bytes, source peak '+(peak*gain).toFixed(3)+', RMS '+(rms*gain).toFixed(3));
 }
 await writeFile('lib/editor/stock-audio-catalog.json',JSON.stringify(manifest,null,2)+'\n');
}finally{await rm(directory,{recursive:true,force:true});}
