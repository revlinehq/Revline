import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
if(!args.includes('--config')||!args.includes('--env-file')||!args.includes('--bucket'))throw new Error('Pass explicit --config, --env-file and --bucket to identify the intended storage environment.');
const config=resolve(value('--config')),envFile=resolve(value('--env-file')),bucket=value('--bucket'),manifest=JSON.parse(await readFile(new URL('../lib/editor/stock-audio-catalog.json',import.meta.url),'utf8'));
const configured=JSON.parse(await readFile(config,'utf8'));if(!configured.r2_buckets?.some(binding=>binding.bucket_name===bucket))throw new Error('Bucket is not declared by the chosen configuration.');
const wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const selected=args.includes('--ids')?manifest.filter(sound=>value('--ids').split(',').includes(sound.id)):manifest;
if(!selected.length)throw new Error('No catalog IDs selected.');
let total=0;
for(const sound of manifest){const bytes=await readFile(sound.file);if(createHash('sha256').update(bytes).digest('hex')!==sound.sha256||bytes.length!==sound.size)throw new Error('Catalog bytes changed: '+sound.id);}
for(let offset=0;offset<selected.length;offset+=4){await Promise.all(selected.slice(offset,offset+4).map(async sound=>{
 const result=spawnSync(process.execPath,[wrangler,'r2','object','put',bucket+'/'+sound.r2Key,'--file',sound.file,'--content-type',sound.contentType,'--cache-control','public,max-age=31536000,immutable','--remote','--config',config,'--env-file',envFile],{encoding:'utf8',env:{...process.env,NO_COLOR:'1'},maxBuffer:1024*1024});
 if(result.status!==0)throw new Error('R2 upload failed for '+sound.id+': '+(result.stderr||result.stdout).replace(/token=[^\s]+/g,'token=<redacted>'));
 total+=sound.size;console.log('Uploaded '+sound.id+' ('+sound.size+' bytes)');
}));}
console.log(JSON.stringify({bucket,objects:selected.length,bytes:total,config}));
