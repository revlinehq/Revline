import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {STOCK_AUDIO_CATALOG} from '../../lib/editor/stock-audio';
import {stockAudioResponse} from '../../lib/server/stock-audio-response';
async function main(){
 let total=0;
 for(const sound of STOCK_AUDIO_CATALOG){const response=await stockAudioResponse(new Request('http://local/api/audio-fx/'+sound.id),sound.id);assert.equal(response.status,200,sound.id);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),sound.sha256);assert.equal(bytes.length,sound.size);total+=bytes.length;}
 const sound=STOCK_AUDIO_CATALOG[0],request=new Request('http://local/api/audio-fx/'+sound.id),head=await stockAudioResponse(new Request(request,{method:'HEAD'}),sound.id);assert.equal(head.status,200);assert.equal(Number(head.headers.get('Content-Length')),sound.size);assert.equal(await head.text(),'');assert.match(head.headers.get('Cache-Control')! ,/public.*immutable/);
 const range=await stockAudioResponse(new Request(request,{headers:{Range:'bytes=0-15'}}),sound.id);assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);assert.equal(range.headers.get('Content-Range'),`bytes 0-15/${sound.size}`);
 assert.equal((await stockAudioResponse(new Request(request,{headers:{'If-None-Match':head.headers.get('ETag')!}}),sound.id)).status,304);assert.equal((await stockAudioResponse(request,'https://example.com/sound')).status,404);
 console.log(JSON.stringify({objects:STOCK_AUDIO_CATALOG.length,bytes:total,configuredMediaOrigin:new URL(process.env.MEDIA_WORKER_URL!).origin}));console.log('PASS: all shared R2 Audio FX hashes/lengths match curated sources; public catalog-only streaming, HEAD, immutable cache, byte range, ETag304 and unknownID404. No signing credentials printed.');
}main().catch(error=>{console.error(error instanceof Error?error.message:'Audio FX verification failed');process.exitCode=1;});
