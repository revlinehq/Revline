import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
// --worker uploads through the media Worker's signed multipart API (MEDIA_WORKER_URL/MEDIA_SIGNING_SECRET
// from --env-file) when Wrangler has no Cloudflare login; objects that already exist are skipped.
const viaWorker=args.includes('--worker');
if(!args.includes('--env-file')||!viaWorker&&(!args.includes('--config')||!args.includes('--bucket')))throw new Error('Pass explicit --config, --env-file and --bucket (or --worker with --env-file) to identify the intended storage environment.');
const envFile=resolve(value('--env-file')),manifest=JSON.parse(await readFile(new URL('../lib/editor/stock-audio-catalog.json',import.meta.url),'utf8'));
const selected=args.includes('--ids')?manifest.filter(sound=>value('--ids').split(',').includes(sound.id)):manifest;
if(!selected.length)throw new Error('No catalog IDs selected.');
let total=0;
for(const sound of manifest){const bytes=await readFile(sound.file);if(createHash('sha256').update(bytes).digest('hex')!==sound.sha256||bytes.length!==sound.size)throw new Error('Catalog bytes changed: '+sound.id);}
if(viaWorker){
 const {parseEnv}=await import('node:util'),{signMediaToken}=await import('../lib/storage/media-tokens.ts'),env=parseEnv(await readFile(envFile,'utf8'));
 const origin=env.MEDIA_WORKER_URL?.replace(/\/$/,''),secret=env.MEDIA_SIGNING_SECRET;if(!origin||!secret)throw new Error('The env file must set MEDIA_WORKER_URL and MEDIA_SIGNING_SECRET.');
 const token=grant=>signMediaToken(secret,{expires:Date.now()+300_000,...grant});
 const control=async body=>{const response=await fetch(origin+'/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await token({operation:'control'})},body:JSON.stringify(body)});if(!response.ok)throw new Error('Media control '+body.action+' failed ('+response.status+')');return response.json();};
 let uploaded=0;
 for(const sound of selected){
  const head=await fetch(origin+'/read?token='+await token({operation:'read',key:sound.r2Key}),{method:'HEAD'});
  if(head.ok&&Number(head.headers.get('Content-Length'))===sound.size){console.log('Exists '+sound.id);continue;}
  const bytes=await readFile(sound.file),{uploadId}=await control({action:'create',key:sound.r2Key,contentType:sound.contentType});
  const part=await fetch(origin+'/part?token='+await token({operation:'part',key:sound.r2Key,uploadId,partNumber:1,size:bytes.length}),{method:'PUT',headers:{'Content-Length':String(bytes.length)},body:bytes});
  if(!part.ok){await control({action:'abort',key:sound.r2Key,uploadId});throw new Error('Upload failed for '+sound.id+' ('+part.status+')');}
  const stored=await control({action:'complete',key:sound.r2Key,uploadId,parts:[{partNumber:1,etag:(await part.json()).etag}]});
  if(stored.size!==sound.size)throw new Error('Stored size differs for '+sound.id);
  uploaded++;total+=sound.size;console.log('Uploaded '+sound.id+' ('+sound.size+' bytes)');
 }
 console.log(JSON.stringify({worker:new URL(origin).host,objects:selected.length,uploaded,bytes:total}));process.exit(0);
}
const config=resolve(value('--config')),bucket=value('--bucket');
const configured=JSON.parse(await readFile(config,'utf8'));if(!configured.r2_buckets?.some(binding=>binding.bucket_name===bucket))throw new Error('Bucket is not declared by the chosen configuration.');
const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
for(let offset=0;offset<selected.length;offset+=4){await Promise.all(selected.slice(offset,offset+4).map(async sound=>{
 const result=spawnSync(process.execPath,[wrangler,'r2','object','put',bucket+'/'+sound.r2Key,'--file',sound.file,'--content-type',sound.contentType,'--cache-control','public,max-age=31536000,immutable','--remote','--config',config,'--env-file',envFile],{encoding:'utf8',env:{...process.env,NO_COLOR:'1'},maxBuffer:1024*1024});
 if(result.status!==0)throw new Error('R2 upload failed for '+sound.id+': '+(result.stderr||result.stdout).replace(/token=[^\s]+/g,'token=<redacted>'));
 total+=sound.size;console.log('Uploaded '+sound.id+' ('+sound.size+' bytes)');
}));}
console.log(JSON.stringify({bucket,objects:selected.length,bytes:total,config}));
