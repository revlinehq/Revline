import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stockAudioResponse } from './stock-audio-response';
import { STOCK_AUDIO_CATALOG } from '../editor/stock-audio';
const signer = vi.hoisted(() => vi.fn(async (_ref: unknown, {catalogId}: {catalogId:string}) => 'https://media.example/read?catalog='+catalogId));
vi.mock('convex/browser',()=>({ConvexHttpClient:class {action=signer;}}));

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test('all catalog sounds have verified source bytes, CC0 provenance and measured waveforms',async()=>{
  expect(STOCK_AUDIO_CATALOG.length).toBeGreaterThanOrEqual(32);
  expect(new Set(STOCK_AUDIO_CATALOG.map(sound=>sound.id)).size).toBe(STOCK_AUDIO_CATALOG.length);
  expect(STOCK_AUDIO_CATALOG.filter(sound=>sound.category==='Whooshes')).toHaveLength(4);
  expect(STOCK_AUDIO_CATALOG.filter(sound=>sound.category==='Risers')).toHaveLength(4);
  for(const sound of STOCK_AUDIO_CATALOG){
    const bytes=await readFile(sound.file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sound.sha256);expect(bytes.length).toBe(sound.size);
    expect(sound.license).toBe('CC0-1.0');expect(sound.sourceUrl).toMatch(/^https:\/\/(kenney\.nl\/assets\/(interface|impact)-sounds|creativecommons\.org\/publicdomain\/zero\/1.0\/)$/);
    expect(sound.duration).toBeGreaterThan(1/24);expect(sound.duration).toBeLessThanOrEqual(4);expect(Buffer.from(sound.waveform.peaks,'base64').some(peak=>peak>0)).toBe(true);
  }
});
test('public route whitelists catalog IDs, streams ranges, caches by content hash and never accepts arbitrary URLs',async()=>{
  const sound=STOCK_AUDIO_CATALOG[0],bytes=await readFile(sound.file);
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://fixture.convex.cloud');signer.mockClear();
  const fetcher=vi.fn(async(input:string|URL|Request,options?:RequestInit)=>{
    const url=new URL(String(input));
    expect(url.origin).toBe('https://media.example');expect(url.searchParams.get('catalog')).toBe(sound.id);
    const range=new Headers(options?.headers).get('Range');
    return range?new Response(bytes.subarray(0,16),{status:206,headers:{'Content-Length':'16','Content-Range':`bytes 0-15/${bytes.length}`}}):new Response(options?.method==='HEAD'?null:bytes,{headers:{'Content-Length':String(bytes.length)}});
  });vi.stubGlobal('fetch',fetcher);
  for(const id of ['unknown','https://attacker.example/file','../ui-click'])expect((await stockAudioResponse(new Request('http://local'),id)).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();expect(signer).not.toHaveBeenCalled();
  const full=await stockAudioResponse(new Request('http://local'),sound.id);expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);expect(full.headers.get('Cache-Control')).toContain('immutable');expect(full.headers.get('Accept-Ranges')).toBe('bytes');
  const range=await stockAudioResponse(new Request('http://local',{headers:{Range:'bytes=0-15'}}),sound.id);expect(range.status).toBe(206);expect((await range.arrayBuffer()).byteLength).toBe(16);expect(range.headers.get('Content-Range')).toBe(`bytes 0-15/${bytes.length}`);
  const head=await stockAudioResponse(new Request('http://local',{method:'HEAD'}),sound.id);expect(head.headers.get('Content-Length')).toBe(String(bytes.length));expect(await head.text()).toBe('');
  const calls=fetcher.mock.calls.length;
  expect((await stockAudioResponse(new Request('http://local',{headers:{'If-None-Match':full.headers.get('ETag')!}}),sound.id)).status).toBe(304);
  for(const range of ['bytes=9-2','bytes=999999-','bytes=-0','bytes=0-2,4-6'])expect((await stockAudioResponse(new Request('http://local',{headers:{Range:range}}),sound.id)).status).toBe(416);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
