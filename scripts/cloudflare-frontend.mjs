import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const mode=process.argv[2]??'build';
if(!['build','preview','deploy'].includes(mode))throw new Error('Choose build, preview, or deploy.');
let production;
try{production=parseEnv(await readFile(process.env.REVLINE_FRONTEND_ENV_FILE??'.env.production.local','utf8'));}
catch(error){
  if(error.code!=='ENOENT'||process.env.REVLINE_FRONTEND_ENV_FILE||mode!=='build')throw error;
  // Git builds use committed public configuration and existing Worker secrets.
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  production={...config.vars,...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('NEXT_PUBLIC_')||key==='APP_ORIGIN'||key==='MEDIA_WORKER_URL'))};
}
if(production.NEXT_PUBLIC_CONVEX_URL!=='https://different-gnu-398.convex.cloud'||!production.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_live_')||(mode!=='build'&&!production.CLERK_SECRET_KEY?.startsWith('sk_live_')))throw new Error('Use the production Convex deployment and live Clerk credentials for the hosted frontend.');
const publicVars=Object.fromEntries(Object.entries(production).filter(([key])=>key.startsWith('NEXT_PUBLIC_')||key==='APP_ORIGIN'||key==='MEDIA_WORKER_URL'));
const secrets={...(production.CLERK_SECRET_KEY?{CLERK_SECRET_KEY:production.CLERK_SECRET_KEY}:{}),...(production.SENTRY_DSN?{SENTRY_DSN:production.SENTRY_DSN}:{})};
const env={...process.env,...publicVars,...secrets,NODE_ENV:'production',WRANGLER_LOG_PATH:process.env.WRANGLER_LOG_PATH??'/tmp/revline-web-wrangler.log'};
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited with status ${code}`)));});}
await run(process.execPath,['node_modules/vite/bin/vite.js','build']);
const configPath='dist/server/wrangler.json',config=JSON.parse(await readFile(configPath,'utf8'));
config.vars={...config.vars,...publicVars};
await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
if(mode==='preview'){
  await writeFile('dist/server/.dev.vars',Object.entries(secrets).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
  await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',configPath,'--port','3108','--inspector-port','0']);
}
if(mode==='deploy'){
  console.log('Deploying frontend: revline-web, production backend different-gnu-398.');
  await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config',configPath]);
  const directory=await mkdtemp(join(tmpdir(),'revline-web-secrets-'));
  try{const path=join(directory,'secrets.json');await writeFile(path,JSON.stringify(secrets),{mode:0o600});await run(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk',path,'--config',configPath]);}
  finally{await rm(directory,{recursive:true,force:true});}
}
