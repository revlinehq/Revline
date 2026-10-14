import { completeDeletion } from '../lib/test-support/convex-deletion';
/// <reference types="vite/client" />
import {convexTest}from'convex-test';
import {afterEach,expect,test,vi}from'vitest';
import {api}from'./_generated/api';
import schema from'./schema';
const modules=import.meta.glob('./**/*.ts');afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
 vi.stubEnv('BILLING_ENABLED','false');const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'}),other=t.withIdentity({subject:'other'});
 const data=await t.run(async ctx=>{
  const projectId=await ctx.db.insert('projects',{ownerId:'owner',title:'Shared edit',aspectRatio:'landscape',createdAt:0,updatedAt:0,revision:0});
  const storageId=await ctx.storage.store(new Blob(['video'],{type:'video/mp4'})),thumbnailStorageId=await ctx.storage.store(new Blob(['thumbnail'],{type:'image/jpeg'}));
  const audioId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'audio',fileName:'audio.mp3',contentType:'audio/mpeg',size:10,duration:4,storageId:await ctx.storage.store(new Blob(['audio'])),createdAt:0});
  const videoId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'video',fileName:'video.mp4',contentType:'video/mp4',size:10,duration:4,width:1920,height:1080,storageId,thumbnailStorageId,audioAssetId:audioId,audioExtracted:true,createdAt:0,analysis:{understanding:{summary:'Private source analysis',scenes:[]}}});
  await ctx.db.patch(projectId,{timeline:{fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:0},clips:[{id:'video',assetId:videoId,kind:'video',track:1,start:0,duration:2,sourceStart:1,volume:0,audioSeparated:true,linkedClipId:'audio'},{id:'audio',assetId:audioId,kind:'audio',track:1,start:0,duration:2,sourceStart:1,linkedClipId:'video'}]}});
  return{projectId,videoId,audioId,storageId,thumbnailStorageId};
 });return{t,owner,other,...data};
}
test('only the owner can publish/revoke; private data is absent from the public snapshot',async()=>{
 const {t,owner,other,projectId}=await fixture();expect(await owner.query(api.timelineShares.status,{projectId})).toBeNull();expect(await t.query(api.timelineShares.get,{shareId:'invalid-link'})).toBeNull();
 await expect(other.mutation(api.timelineShares.publish,{projectId})).rejects.toThrow('Project not found');
 const shareId=await owner.mutation(api.timelineShares.publish,{projectId}),snapshot=await t.query(api.timelineShares.get,{shareId});expect(snapshot?.assets).toHaveLength(2);expect(snapshot?.timeline.clips[0].sourceStart).toBe(1);
 expect(snapshot?.assets.every(asset=>!('ownerId'in asset)&&!('analysis'in asset)&&!('projectId'in asset))).toBe(true);
 await expect(other.mutation(api.timelineShares.revoke,{projectId})).rejects.toThrow('Project not found');await owner.mutation(api.timelineShares.revoke,{projectId});expect(await t.query(api.timelineShares.get,{shareId})).toBeNull();
});
test('a viewer gets an independent owned copy with original files and remapped video/audio references',async()=>{
 const {t,owner,other,projectId,videoId,audioId,storageId}=await fixture(),shareId=await owner.mutation(api.timelineShares.publish,{projectId});
 await expect(t.mutation(api.timelineShares.useTimeline,{shareId})).rejects.toThrow('Authentication required');
 const copyId=await other.mutation(api.timelineShares.useTimeline,{shareId}),copy=await other.query(api.projects.get,{projectId:copyId}),sources=await other.query(api.assets.list,{projectId:copyId});
 expect(copy.ownerId).toBe('other');expect(copyId).not.toBe(projectId);expect(copy.timeline?.clips).toHaveLength(2);
 const video=sources.find(asset=>asset.kind==='video')!,audio=sources.find(asset=>asset.kind==='audio')!;
 expect(video._id).not.toBe(videoId);expect(audio._id).not.toBe(audioId);expect(video.storageId).toBe(storageId);expect(video.audioAssetId).toBe(audio._id);expect(copy.timeline?.clips[0].assetId).toBe(video._id);expect(copy.timeline?.clips[1].assetId).toBe(audio._id);
 await t.run(ctx=>ctx.db.patch(copyId,{title:'My own version'}));expect((await owner.query(api.projects.get,{projectId})).title).toBe('Shared edit');
});
test('published edits are snapshots and source removal cannot break them',async()=>{
 const {t,owner,projectId,videoId,audioId,storageId,thumbnailStorageId}=await fixture(),shareId=await owner.mutation(api.timelineShares.publish,{projectId});
 await t.run(ctx=>ctx.db.patch(projectId,{title:'Changed privately',timeline:{fps:30,aspectRatio:'landscape',clips:[]}}));
 await owner.mutation(api.assets.remove,{assetId:videoId});await owner.mutation(api.assets.remove,{assetId:audioId});
 const snapshot=await t.query(api.timelineShares.get,{shareId});expect(snapshot?.title).toBe('Shared edit');expect(snapshot?.timeline.clips).toHaveLength(2);expect(await t.run(async ctx=>!!await ctx.storage.get(storageId))).toBe(true);expect(await t.run(async ctx=>!!await ctx.storage.get(thumbnailStorageId))).toBe(true);
 await owner.mutation(api.timelineShares.revoke,{projectId});expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();expect(await t.run(ctx=>ctx.storage.get(thumbnailStorageId))).toBeNull();
});
test('deleting an original project turns off its link while retained copies keep their media',async()=>{
 const {t,owner,other,projectId,storageId}=await fixture(),shareId=await owner.mutation(api.timelineShares.publish,{projectId}),copyId=await other.mutation(api.timelineShares.useTimeline,{shareId});
 await owner.mutation(api.projects.remove,{projectId});await completeDeletion(t,projectId);expect(await t.query(api.timelineShares.get,{shareId})).toBeNull();expect(await t.run(async ctx=>!!await ctx.storage.get(storageId))).toBe(true);expect((await other.query(api.assets.list,{projectId:copyId}))).toHaveLength(2);
});
