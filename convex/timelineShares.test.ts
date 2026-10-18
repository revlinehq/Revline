import { writeProject } from './lib/project_data';
import { completeDeletion } from '../lib/test-support/convex-deletion';
/// <reference types="vite/client" />
import {convexTest}from'convex-test';
import {afterEach,expect,test,vi}from'vitest';
import {api,components}from'./_generated/api';
import agentTest from '@convex-dev/agent/test';
import {createThread,saveMessages}from'@convex-dev/agent';
import schema from'./schema';
const modules=import.meta.glob('./**/*.ts');afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
 vi.stubEnv('BILLING_ENABLED','false');const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner'}),other=t.withIdentity({subject:'other'});
 const data=await t.run(async ctx=>{
  const projectId=await ctx.db.insert('projects',{ownerId:'owner',title:'Shared edit',aspectRatio:'landscape',createdAt:0,updatedAt:0,revision:0});
  const storageId=await ctx.storage.store(new Blob(['video'],{type:'video/mp4'})),thumbnailStorageId=await ctx.storage.store(new Blob(['thumbnail'],{type:'image/jpeg'}));
  const audioId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'audio',fileName:'audio.mp3',contentType:'audio/mpeg',size:10,duration:4,storageId:await ctx.storage.store(new Blob(['audio'])),createdAt:0});
  const videoId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'video',fileName:'video.mp4',contentType:'video/mp4',size:10,duration:4,width:1920,height:1080,storageId,thumbnailStorageId,audioAssetId:audioId,audioExtracted:true,createdAt:0,analysis:{understanding:{summary:'Private source analysis',scenes:[]}}});
  await writeProject(ctx,projectId,{timeline:{fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:0},clips:[{id:'video',assetId:videoId,kind:'video',track:1,start:0,duration:2,sourceStart:1,volume:0,audioSeparated:true,linkedClipId:'audio'},{id:'audio',assetId:audioId,kind:'audio',track:1,start:0,duration:2,sourceStart:1,linkedClipId:'video'}]}});
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
 await t.run(ctx=>writeProject(ctx,projectId,{title:'Changed privately',timeline:{fps:30,aspectRatio:'landscape',clips:[]}}));
 await owner.mutation(api.assets.remove,{assetId:videoId});await owner.mutation(api.assets.remove,{assetId:audioId});
 const snapshot=await t.query(api.timelineShares.get,{shareId});expect(snapshot?.title).toBe('Shared edit');expect(snapshot?.timeline.clips).toHaveLength(2);expect(await t.run(async ctx=>!!await ctx.storage.get(storageId))).toBe(true);expect(await t.run(async ctx=>!!await ctx.storage.get(thumbnailStorageId))).toBe(true);
 await owner.mutation(api.timelineShares.revoke,{projectId});expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();expect(await t.run(ctx=>ctx.storage.get(thumbnailStorageId))).toBeNull();
});
test('deleting an original project turns off its link while retained copies keep their media',async()=>{
 const {t,owner,other,projectId,storageId}=await fixture(),shareId=await owner.mutation(api.timelineShares.publish,{projectId}),copyId=await other.mutation(api.timelineShares.useTimeline,{shareId});
 await owner.mutation(api.projects.remove,{projectId});await completeDeletion(t,projectId);expect(await t.query(api.timelineShares.get,{shareId})).toBeNull();expect(await t.run(async ctx=>!!await ctx.storage.get(storageId))).toBe(true);expect((await other.query(api.assets.list,{projectId:copyId}))).toHaveLength(2);
});

async function chatFixture() {
 const f=await fixture();agentTest.register(f.t);
 const threadId=await f.t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
 await f.t.run(ctx=>writeProject(ctx,f.projectId,{threadId}));
 const save=async(messages:Parameters<typeof saveMessages>[2]['messages'],metadata?:Parameters<typeof saveMessages>[2]['metadata'],thread=threadId,userId='owner')=>f.t.run(ctx=>saveMessages(ctx,components.agent,{threadId:thread,userId,messages,...(metadata?{metadata}:{})}));
 return{...f,threadId,save,preview:()=>f.owner.query(api.timelineShares.chatPreview,{projectId:f.projectId})};
}

test('chat sharing defaults off and opt-in publishes only previewed plain conversation, frozen until an explicit update',async()=>{
 const f=await chatFixture();
 await f.save([{role:'user',content:'Tighten this edit https://private.example/read?token=SECRET'},{role:'assistant',content:'I kept the complete sentences.'}]);
 const preview=await f.preview();expect(preview.messages.map(m=>m.text)).toEqual(['Tighten this edit [link removed]','I kept the complete sentences.']);
 const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat).toBeUndefined();
 expect(await f.owner.query(api.timelineShares.status,{projectId:f.projectId})).toMatchObject({includesChat:false});
 await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:preview.messages});
 const frozen=preview.messages.map(({role,text})=>({role,text}));
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat).toEqual(frozen);
 expect(await f.owner.query(api.timelineShares.status,{projectId:f.projectId})).toMatchObject({includesChat:true});
 await f.save([{role:'user',content:'A later private request'}]);
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat).toEqual(frozen);
 const copyId=await f.other.mutation(api.timelineShares.useTimeline,{shareId});
 expect((await f.other.query(api.projects.get,{projectId:copyId})).threadId).toBeUndefined();
 await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat).toBeUndefined();
 await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:preview.messages.slice(0,1)});
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat).toEqual(frozen.slice(0,1));
 await f.owner.mutation(api.timelineShares.revoke,{projectId:f.projectId});
 expect(await f.t.query(api.timelineShares.get,{shareId})).toBeNull();
 expect(await f.t.run(ctx=>ctx.db.get(shareId))).not.toHaveProperty('chat');
});

test('share preview excludes system, tools, reasoning, failed messages, receipts and operational error summaries',async()=>{
 const f=await chatFixture();
 await f.save([{role:'system',content:'PRIVATE SYSTEM'},{role:'user',content:'Add subtitles'},{role:'assistant',content:[{type:'reasoning',text:'PRIVATE THOUGHTS'},{type:'text',text:'Subtitles added.'}]},{role:'assistant',content:[{type:'tool-call',toolCallId:'secret-call',toolName:'inspectFrames',input:{signedUrl:'SECRET TOOL'}}]},{role:'tool',content:[{type:'tool-result',toolCallId:'secret-call',toolName:'inspectFrames',output:{type:'json',value:{secret:'TOOL OUTPUT'}}}]}]);
 await f.save([{role:'assistant',content:'Your replacement edit is saved.'}],[{providerMetadata:{revline:{publicationReceipt:{kind:'timeline-publication'}}}}]);
 await f.save([{role:'assistant',content:'No timeline changes were saved. PRIVATE FAILURE'}]);
 await f.save([{role:'assistant',content:'FAILED MESSAGE'}],[{status:'failed',error:'PRIVATE STACK'}]);
 const preview=await f.preview();expect(preview.messages.map(m=>m.text)).toEqual(['Add subtitles','Subtitles added.']);
 const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:preview.messages});
 const chat=(await f.t.query(api.timelineShares.get,{shareId}))!.chat!;
 expect(chat).toEqual([{role:'user',text:'Add subtitles'},{role:'assistant',text:'Subtitles added.'}]);
 expect(JSON.stringify(chat)).not.toMatch(/PRIVATE|TOOL|receipt|thread|model|provider|usage|_id|reasoning/);
});

test('foreign owners, other conversations, stale or edited messages and duplicate selections cannot publish chat',async()=>{
 const f=await chatFixture();await f.save([{role:'user',content:'Original private message'}]);
 const preview=await f.preview();
 await expect(f.other.query(api.timelineShares.chatPreview,{projectId:f.projectId})).rejects.toThrow('Project not found');
 await expect(f.t.query(api.timelineShares.chatPreview,{projectId:f.projectId})).rejects.toThrow('Authentication required');
 await expect(f.other.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:preview.messages})).rejects.toThrow('Project not found');
 const foreign=await f.t.run(ctx=>createThread(ctx,components.agent,{userId:'other'}));
 const [otherMessage]=(await f.save([{role:'user',content:'FOREIGN CONVERSATION'}],undefined,foreign,'other')).messages;
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:[{id:otherMessage._id,role:'user',text:'FOREIGN CONVERSATION'}]})).rejects.toThrow('Chat preview changed');
 const sameOwnerThread=await f.t.run(ctx=>createThread(ctx,components.agent,{userId:'owner'}));
 const [sameOwnerMessage]=(await f.save([{role:'user',content:'ANOTHER PROJECT'}],undefined,sameOwnerThread)).messages;
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:[{id:sameOwnerMessage._id,role:'user',text:'ANOTHER PROJECT'}]})).rejects.toThrow('Chat preview changed');
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:[...preview.messages,...preview.messages]})).rejects.toThrow('too large');
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:[{...preview.messages[0],text:'Forged replacement'}]})).rejects.toThrow('Chat preview changed');
 await f.t.run(ctx=>ctx.runMutation(components.agent.messages.deleteByIds,{messageIds:[preview.messages[0].id]}));
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:preview.messages})).rejects.toThrow('Chat preview changed');
 expect(await f.owner.query(api.timelineShares.status,{projectId:f.projectId})).toBeNull();
});

test('preview and publication bound conversation size without exposing earlier unpreviewed records',async()=>{
 const f=await chatFixture();
 for(let batch=0;batch<3;batch++)await f.save(Array.from({length:20},(_,index)=>({role:'user' as const,content:`Message ${batch*20+index}`})));
 const preview=await f.preview();expect(preview.messages).toHaveLength(40);expect(preview.truncated).toBe(true);expect(preview.messages[0].text).toBe('Message 20');
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:Array.from({length:41},(_,i)=>({...preview.messages[0],id:`${preview.messages[0].id}-${i}`}))})).rejects.toThrow('too large');
 await f.save([{role:'user',content:'a'.repeat(5_000)}]);
 const shortened=await f.preview();expect(shortened.messages.at(-1)!.text).toHaveLength(4_000);expect(shortened.truncated).toBe(true);
 const shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:shortened.messages});
 expect((await f.t.query(api.timelineShares.get,{shareId}))?.chat?.at(-1)?.text).toBe(shortened.messages.at(-1)!.text);
 await f.save(Array.from({length:10},()=>({role:'user' as const,content:'b'.repeat(5_000)})));
 const bounded=await f.preview();expect(bounded.messages).toHaveLength(8);expect(bounded.messages.reduce((sum,m)=>sum+m.text.length,0)).toBe(32_000);expect(bounded.truncated).toBe(true);
 await expect(f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId,chat:[...bounded.messages,{...shortened.messages.at(-1)!}]})).rejects.toThrow('too large');
});
