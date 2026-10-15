/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { stockAudio, STOCK_AUDIO_CATALOG, isStockAudioKey } from '../lib/editor/stock-audio';
import { addMediaClip, patchClip } from '../lib/editor/operations';
import { recordAssetStorage, recordStorageObject } from './lib/storage_accounting';
import { completeDeletion } from '../lib/test-support/convex-deletion';
import { verifyMediaToken } from '../lib/storage/media-tokens';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://fixture.clerk.accounts.dev', tokenIdentifier: `fixture|${subject}` });
const make = () => convexTest(schema, modules);
type Fixture = ReturnType<typeof make>;
const sound = () => STOCK_AUDIO_CATALOG[0];
beforeEach(() => {
  vi.useFakeTimers();vi.stubEnv('BILLING_ENABLED', 'false');
  vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com');vi.stubEnv('MEDIA_SIGNING_SECRET', 'fixture-signing');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
});
afterEach(() => { vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals(); });
async function project(t: Fixture, ownerId = 'owner') { return t.withIdentity(identity(ownerId)).mutation(api.projects.create, { title: 'Audio FX fixture', aspectRatio: 'vertical' }); }
async function sideEffects(t: Fixture) {
  return t.run(async ctx => ({
    assets: await ctx.db.query('assets').collect(),
    tasks: await ctx.db.query('mediaTasks').collect(),
    uploads: await ctx.db.query('r2Uploads').collect(),
    tickets: await ctx.db.query('uploadTickets').collect(),
    objects: await ctx.db.query('storageObjects').collect(),
    jobs: await ctx.db.system.query('_scheduled_functions').collect(),
  }));
}

test('public catalog signing accepts only curated IDs and issues an expiring read capability without auth or work', async () => {
  const t=make(),entry=sound();
  const url=new URL(await t.action(api.assets.catalogAudioUrl,{catalogId:entry.id}));
  expect(url.origin+url.pathname).toBe('https://media.example.com/read');
  const token=url.searchParams.get('token')!;
  expect(await verifyMediaToken('fixture-signing',token)).toEqual({operation:'read',key:entry.r2Key,expires:Date.now()+3600_000});
  for(const catalogId of ['', 'unknown', entry.r2Key, 'https://arbitrary.example/private.ogg'])await expect(t.action(api.assets.catalogAudioUrl,{catalogId})).rejects.toThrow('Audio FX not found');
  await expect(t.action(api.assets.catalogAudioUrl,{catalogId:entry.id,key:'media/private',url:'https://arbitrary.example/private.ogg'} as never)).rejects.toThrow();
  vi.advanceTimersByTime(3600_000);expect(await verifyMediaToken('fixture-signing',token)).toBeNull();
  const snapshot=await sideEffects(t);for(const key of Object.keys(snapshot) as (keyof typeof snapshot)[])expect(snapshot[key]).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test('stock registration is authenticated, project-owned and editor-access gated, without client media metadata', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),stranger=t.withIdentity(identity('stranger'));
  const args={projectId,catalogId:sound().id};
  await expect(t.mutation(api.assets.registerStockAudio,args)).rejects.toThrow('Authentication required');
  await expect(stranger.mutation(api.assets.registerStockAudio,args)).rejects.toThrow('Project not found');
  for(const catalogId of ['', 'unknown', 'https://arbitrary.example/audio.ogg', sound().r2Key])await expect(owner.mutation(api.assets.registerStockAudio,{...args,catalogId})).rejects.toThrow('Audio FX');
  // A caller cannot override the trusted manifest's object key, duration, waveform or URL.
  await expect(owner.mutation(api.assets.registerStockAudio,{...args,r2Key:'media/arbitrary',url:'https://arbitrary.example/audio.ogg'} as never)).rejects.toThrow();
  vi.stubEnv('BILLING_ENABLED','true');
  await expect(owner.mutation(api.assets.registerStockAudio,args)).rejects.toThrow('Billing');
  await t.run(ctx=>ctx.db.insert('editorEntitlements',{ownerId:'owner',grantedAt:Date.now(),updatedAt:Date.now(),reason:'fixture'}));
  const registered=await owner.mutation(api.assets.registerStockAudio,args);expect(registered.ownerId).toBe('owner');
  expect(fetch).not.toHaveBeenCalled();
});

test('registration derives exact metadata and waveform, reuses concurrently and across reload, and schedules no work', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),entry=sound();
  const results=await Promise.all(Array.from({length:5},()=>owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id})));
  expect(new Set(results.map(asset=>asset._id)).size).toBe(1);
  const asset=results[0];expect(stockAudio(entry.id)).toEqual(entry);expect(asset).toMatchObject({projectId,ownerId:'owner',kind:'audio',contentType:'audio/ogg',duration:entry.duration,size:entry.size,r2Key:entry.r2Key,waveform:entry.waveform,fileName:entry.name+'.ogg'});
  expect(asset.url).toContain('https://media.example.com/read?token=');
  const listed=await owner.query(api.assets.list,{projectId});expect(listed).toEqual([asset]);
  expect(await owner.query(api.assets.get,{projectId,assetId:asset._id})).toEqual(asset);
  expect((await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id}))._id).toBe(asset._id);
  const snapshot=await sideEffects(t);expect(snapshot.assets).toHaveLength(1);for(const key of ['tasks','uploads','tickets','objects','jobs'] as const)expect(snapshot[key]).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test('every curated sound registers its real precomputed waveform without uploads or analysis', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner'));
  for(const entry of STOCK_AUDIO_CATALOG) {
    const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});
    expect(asset).toMatchObject({fileName:entry.name+'.ogg',r2Key:entry.r2Key,size:entry.size,duration:entry.duration,waveform:entry.waveform});
    expect(isStockAudioKey(asset.r2Key)).toBe(true);
  }
  const snapshot=await sideEffects(t);expect(snapshot.assets).toHaveLength(STOCK_AUDIO_CATALOG.length);
  for(const key of ['tasks','uploads','tickets','objects','jobs'] as const)expect(snapshot[key]).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test('curated sounds do not consume per-owner storage, including backfill, while arbitrary prefix keys still count', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),entry=sound();
  vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','1');await t.mutation(internal.storageMigration.ready,{});
  const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});
  await t.run(async ctx=>{const doc=(await ctx.db.get(asset._id))!;await recordAssetStorage(ctx,doc);await recordAssetStorage(ctx,doc,true);await recordStorageObject(ctx,{...doc,pending:true});});
  expect(await owner.query(api.storage.summary,{})).toMatchObject({usedBytes:0,reservedBytes:0,audioBytes:0,fileCount:0,ready:true});
  expect((await owner.query(api.storage.files,{paginationOpts:{cursor:null,numItems:20},sort:'largest'})).page).toEqual([]);
  vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','1000');const unknown=entry.r2Key+'-unknown';expect(isStockAudioKey(unknown)).toBe(false);
  await t.run(ctx=>recordStorageObject(ctx,{ownerId:'owner',r2Key:unknown,fileName:'Ordinary audio.ogg',kind:'audio',size:17,createdAt:1}));
  expect(await owner.query(api.storage.summary,{})).toMatchObject({usedBytes:17,audioBytes:17,fileCount:1});
});

test('save/reload and owned project copies preserve audio edits and reuse the catalog reference without quota or jobs', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),entry=sound();
  const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});
  const doc=await owner.query(api.projects.get,{projectId});const timeline=patchClip(addMediaClip(doc.timeline!,asset,'sound'), 'sound',{volume:.4});
  await owner.mutation(api.projects.saveTimeline,{projectId,expectedRevision:0,timeline});
  const reloaded=await owner.query(api.projects.get,{projectId});expect(reloaded.timeline?.clips[0]).toMatchObject({kind:'audio',assetId:asset._id,duration:entry.duration,volume:.4});
  const copied=await owner.mutation(api.projects.create,{title:'Copied audio',aspectRatio:'vertical',assetIds:[asset._id]});
  const copies=await owner.query(api.assets.list,{projectId:copied});expect(copies).toHaveLength(1);expect(copies[0]).toMatchObject({r2Key:entry.r2Key,waveform:entry.waveform,duration:entry.duration});
  expect((await owner.mutation(api.assets.registerStockAudio,{projectId:copied,catalogId:entry.id}))._id).toBe(copies[0]._id);
  const snapshot=await sideEffects(t);expect(snapshot.assets).toHaveLength(2);expect(snapshot.tasks).toEqual([]);expect(snapshot.objects).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});

test('published snapshots and cross-account copies keep waveform and global audio after every owner/project cleanup', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),other=t.withIdentity(identity('other')),entry=sound();
  const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});const doc=await owner.query(api.projects.get,{projectId});
  await owner.mutation(api.projects.saveTimeline,{projectId,expectedRevision:0,timeline:addMediaClip(doc.timeline!,asset,'sound')});
  const shareId=await owner.mutation(api.timelineShares.publish,{projectId});const publicShare=await t.query(api.timelineShares.get,{shareId});
  expect(publicShare?.assets[0]).toMatchObject({kind:'audio',duration:entry.duration,waveform:entry.waveform,url:expect.stringContaining('/read?token=')});
  const copied=await other.mutation(api.timelineShares.useTimeline,{shareId});const copiedAsset=(await other.query(api.assets.list,{projectId:copied}))[0];expect(copiedAsset).toMatchObject({ownerId:'other',r2Key:entry.r2Key,waveform:entry.waveform});
  expect((await other.mutation(api.assets.registerStockAudio,{projectId:copied,catalogId:entry.id}))._id).toBe(copiedAsset._id);
  await owner.mutation(api.timelineShares.revoke,{projectId});await owner.mutation(api.projects.remove,{projectId});await completeDeletion(t,projectId);
  expect((await other.query(api.assets.get,{projectId:copied,assetId:copiedAsset._id})).url).toContain('/read?token=');
  await other.mutation(api.projects.remove,{projectId:copied});await completeDeletion(t,copied);
  const snapshot=await sideEffects(t);expect(snapshot.assets).toEqual([]);expect(snapshot.objects).toEqual([]);expect(snapshot.tasks).toEqual([]);expect(snapshot.jobs.filter(job=>job.name==='r2:deleteObject')).toEqual([]);
  expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(0);expect((await other.query(api.storage.summary,{})).usedBytes).toBe(0);expect(fetch).not.toHaveBeenCalled();
});

test('removing the last unused catalog attachment and direct generic deletion cannot delete global objects', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),entry=sound();
  const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});await owner.mutation(api.assets.remove,{assetId:asset._id});
  expect(await t.run(ctx=>ctx.db.get(asset._id))).toBeNull();expect((await sideEffects(t)).jobs).toEqual([]);
  await t.action(internal.r2.deleteObject,{key:entry.r2Key});expect(fetch).not.toHaveBeenCalled();
  const unknown=entry.r2Key+'-unknown';await t.action(internal.r2.deleteObject,{key:unknown});expect(fetch).toHaveBeenCalledOnce();expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({action:'delete',key:unknown});
});

test('expired lease cleanup cannot delete a catalog object even if an internal lease references it', async () => {
  const t=make(),projectId=await project(t),entry=sound();
  const uploadId=await t.run(ctx=>ctx.db.insert('r2Uploads',{ownerId:'owner',projectId,key:entry.r2Key,uploadId:'stale',fileName:entry.name+'.ogg',contentType:entry.contentType,kind:'audio',size:entry.size,partSize:entry.size,expiresAt:Date.now()-1,completed:false}));
  await t.action(internal.r2.cleanupLease,{uploadId});
  expect(await t.run(ctx=>ctx.db.get(uploadId))).toBeNull();expect(fetch).not.toHaveBeenCalled();expect((await sideEffects(t)).jobs).toEqual([]);
});

test('catalog registration obeys the existing project source limit, but already registered sounds remain reusable', async () => {
  const t=make(),projectId=await project(t),owner=t.withIdentity(identity('owner')),entry=sound();
  const asset=await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id});
  await t.run(async ctx=>{for(let index=0;index<199;index++)await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'image',fileName:`${index}.png`,contentType:'image/png',size:1,createdAt:1});});
  expect((await owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:entry.id}))._id).toBe(asset._id);
  await expect(owner.mutation(api.assets.registerStockAudio,{projectId,catalogId:STOCK_AUDIO_CATALOG[1].id})).rejects.toThrow('200 media files');
});
