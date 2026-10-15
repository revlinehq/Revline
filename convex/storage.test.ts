import { completeDeletion } from '../lib/test-support/convex-deletion';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workflowTest from '@convex-dev/workflow/test';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { api,internal } from './_generated/api';
import schema from './schema';
import { recordAssetStorage } from './lib/storage_accounting';
import type { Id } from './_generated/dataModel';
const modules=import.meta.glob('./**/*.ts');
const identity=(subject:string)=>({subject,issuer:'https://fixture.clerk.accounts.dev',tokenIdentifier:`fixture|${subject}`});
const make=()=>{const t=convexTest(schema,modules);workflowTest.register(t);return t;};
type Fixture=ReturnType<typeof make>;
beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('BILLING_ENABLED','false');vi.stubEnv('MEDIA_WORKER_URL','https://media.example.com');vi.stubEnv('MEDIA_SIGNING_SECRET','test-signing');vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','1000');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({uploadId:'upload',size:200,contentType:'image/png'})));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function project(t:Fixture,ownerId='owner'){return t.withIdentity(identity(ownerId)).mutation(api.projects.create,{title:`${ownerId} workspace`,aspectRatio:'vertical'});}
async function asset(t:Fixture,projectId:Id<'projects'>,size=300,key='media/owner/project/object',ownerId='owner',indexed=true){return t.run(async ctx=>{const id=await ctx.db.insert('assets',{ownerId,projectId,r2Key:key,size,fileName:`${key.split('/').at(-1)}.png`,contentType:'image/png',kind:'image',createdAt:1});if(indexed)await recordAssetStorage(ctx,(await ctx.db.get(id))!);return id;});}
const listing={paginationOpts:{cursor:null,numItems:20},sort:'largest' as const};

test('file listings reuse project protection reads without sharing per-file decisions or later snapshots',async()=>{
  const t=make(),p=await project(t),second=await project(t),owner=t.withIdentity(identity('owner'));
  const ids=await Promise.all(Array.from({length:4},(_,index)=>asset(t,p,100,`media/owner/project/object-${index}`)));
  const secondId=await asset(t,second,100,'media/owner/second/object');
  await t.run(async ctx=>{
    for(const [projectId,ownerId,status,assetIds] of [[p,'owner','queued',[ids[0]]],[p,'owner','rendering',[ids[1]]],[p,'owner','completed',[ids[2]]],[p,'other','queued',[ids[3]]],[second,'owner','queued',[secondId]]] as const)
      await ctx.db.insert('renderJobs',{projectId,ownerId,status,assetIds:[...assetIds],createdAt:0,updatedAt:0});
  });
  const {files}=await import('./storage');
  async function trace(){return t.run(async ctx=>{
    const tables:string[]=[],reads:string[]=[];
    const db=new Proxy(ctx.db,{get(target,property,receiver){
      if(property==='query')return(...args:unknown[])=>{tables.push(String(args[0]));return Reflect.apply(target.query,target,args);};
      if(property==='get')return(...args:unknown[])=>{reads.push(String(args.at(-1)));return Reflect.apply(target.get,target,args);};
      return Reflect.get(target,property,receiver);
    }});
    const result=await (files as unknown as {_handler:(ctx:unknown,args:unknown)=>Promise<{page:{id:Id<'storageObjects'>;fileName:string;canDelete:boolean;protectedReason:string|null}[]}>})._handler({...ctx,db,auth:{getUserIdentity:async()=>identity('owner')}},listing);
    return {result,tables,reads};
  });}
  const first=await trace(),items=new Map(first.result.page.map(row=>[row.fileName,row]));
  expect(items.get('object-0.png')).toMatchObject({canDelete:false,protectedReason:'Used by an active export'});
  expect(items.get('object-1.png')).toMatchObject({canDelete:false,protectedReason:'Used by an active export'});
  expect(items.get('object-2.png')?.canDelete).toBe(true);expect(items.get('object-3.png')?.canDelete).toBe(true);
  expect(items.get('object.png')).toMatchObject({canDelete:false,protectedReason:'Used by an active export'});
  expect(first.reads.filter(id=>id===p)).toHaveLength(1);expect(first.reads.filter(id=>id===second)).toHaveLength(1);
  expect(first.tables.filter(table=>table==='projectAccess')).toHaveLength(2);
  expect(first.tables.filter(table=>table==='aiRuns')).toHaveLength(2);
  expect(first.tables.filter(table=>table==='renderJobs')).toHaveLength(4);
  expect(first.tables.filter(table=>table==='assets')).toHaveLength(5);expect(first.tables.filter(table=>table==='shareAssets')).toHaveLength(5);
  for(const status of ['queued','rendering'] as const){
    const saturated=await t.run(ctx=>ctx.db.insert('renderJobs',{projectId:p,ownerId:'owner',status,assetIds:[ids[0]],createdAt:0,updatedAt:0}));
    expect((await owner.query(api.storage.files,listing)).page.find(row=>row.fileName==='object-2.png')).toMatchObject({canDelete:false,protectedReason:'Used by an active export'});
    await expect(owner.mutation(api.storage.remove,{fileIds:[items.get('object-2.png')!.id]})).rejects.toThrow('Used by an active export');
    await t.run(ctx=>ctx.db.patch(saturated,{status:'completed'}));
    expect((await owner.query(api.storage.files,listing)).page.find(row=>row.fileName==='object-2.png')?.canDelete).toBe(true);
  }
  await t.run(async ctx=>{const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',p)).unique();await ctx.db.patch(run!._id,{aiRunning:true});});
  expect((await owner.query(api.storage.files,listing)).page.find(row=>row.fileName==='object-2.png')).toMatchObject({canDelete:false,protectedReason:'AI editing in progress'});
  await t.run(async ctx=>{
    const run=await ctx.db.query('aiRuns').withIndex('by_project',q=>q.eq('projectId',p)).unique(),access=await ctx.db.query('projectAccess').withIndex('by_project',q=>q.eq('projectId',p)).unique();
    await ctx.db.delete(run!._id);await ctx.db.delete(access!._id);await ctx.db.patch(p,{aiRunning:true});
  });
  expect((await owner.query(api.storage.files,listing)).page.find(row=>row.fileName==='object-2.png')).toMatchObject({canDelete:false,protectedReason:'AI editing in progress'});
  await t.run(ctx=>ctx.db.patch(p,{deleting:true}));
  await expect(owner.query(api.storage.files,listing)).rejects.toThrow('Project not found');
  await expect(owner.mutation(api.storage.remove,{fileIds:[items.get('object-2.png')!.id]})).rejects.toThrow('Project not found');
});

test('storage reads and deletions are owned, cleanup works without paid access',async()=>{
  const t=make(),p=await project(t),id=await asset(t,p),owner=t.withIdentity(identity('owner')),other=t.withIdentity(identity('other'));
  const file=(await owner.query(api.storage.files,listing)).page[0];
  await expect(t.query(api.storage.summary,{})).rejects.toThrow('Authentication required');
  await expect(t.query(api.storage.files,listing)).rejects.toThrow('Authentication required');
  expect((await other.query(api.storage.summary,{})).usedBytes).toBe(0);expect((await other.query(api.storage.files,listing)).page).toEqual([]);
  await expect(other.mutation(api.storage.remove,{fileIds:[file.id]})).rejects.toThrow('File not found');
  await expect(t.mutation(api.storage.remove,{fileIds:[file.id]})).rejects.toThrow('Authentication required');
  vi.stubEnv('BILLING_ENABLED','true');
  await owner.mutation(api.storage.remove,{fileIds:[file.id]});expect(await t.run(ctx=>ctx.db.get(id))).toBeNull();expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(0);
  await t.finishAllScheduledFunctions(vi.runAllTimers);expect(fetch).toHaveBeenCalledOnce();
});
test('reused objects count once and cannot be deleted while any workspace uses them',async()=>{
  const t=make(),p=await project(t),id=await asset(t,p),owner=t.withIdentity(identity('owner'));
  const copy=await owner.mutation(api.projects.create,{title:'Reused',aspectRatio:'vertical',assetIds:[id]});
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({usedBytes:300,imageBytes:300,fileCount:1});
  const file=(await owner.query(api.storage.files,listing)).page[0];expect(file).toMatchObject({canDelete:false,protectedReason:'Used in an edit',workspaces:[{id:copy,title:'Reused'}]});
  await expect(owner.mutation(api.storage.remove,{fileIds:[file.id]})).rejects.toThrow('Used in an edit');
  await owner.mutation(api.assets.remove,{assetId:id});expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(300);
  await owner.mutation(api.projects.remove,{projectId:copy});await completeDeletion(t, copy);expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(0);
  expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').filter(q=>q.eq(q.field('name'),'r2:deleteObject')).collect())).toHaveLength(1);
});
test('deletion rechecks the current timeline and a bulk rejection leaves every file intact',async()=>{
  const t=make(),p=await project(t),a=await asset(t,p,200),b=await asset(t,p,300,'media/owner/project/second'),owner=t.withIdentity(identity('owner'));
  const files=(await owner.query(api.storage.files,listing)).page;expect(files.every(f=>f.canDelete)).toBe(true);
  const {addMediaClip}=await import('../lib/editor/operations');const doc=await owner.query(api.projects.get,{projectId:p});
  await owner.mutation(api.projects.saveTimeline,{projectId:p,expectedRevision:0,timeline:addMediaClip(doc.timeline!,{_id:a,kind:'image'},'image')});
  await expect(owner.mutation(api.storage.remove,{fileIds:files.map(f=>f.id)})).rejects.toThrow('Used in an edit');
  expect(await t.run(ctx=>ctx.db.get(b))).not.toBeNull();expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(500);
});
test('shared snapshots protect the last attachment and cross-account copies keep independent quota',async()=>{
  const t=make(),p=await project(t),id=await asset(t,p),owner=t.withIdentity(identity('owner')),other=t.withIdentity(identity('other'));
  const {addMediaClip}=await import('../lib/editor/operations');const doc=await owner.query(api.projects.get,{projectId:p});
  await owner.mutation(api.projects.saveTimeline,{projectId:p,expectedRevision:0,timeline:addMediaClip(doc.timeline!,{_id:id,kind:'image'},'image')});
  const share=await owner.mutation(api.timelineShares.publish,{projectId:p});await other.mutation(api.timelineShares.useTimeline,{shareId:share});
  await owner.mutation(api.projects.saveTimeline,{projectId:p,expectedRevision:1,timeline:{...doc.timeline!,clips:[]}});
  const file=(await owner.query(api.storage.files,listing)).page[0];expect(file.protectedReason).toBe('Used by a shared timeline');
  await expect(owner.mutation(api.storage.remove,{fileIds:[file.id]})).rejects.toThrow('shared timeline');
  await owner.mutation(api.timelineShares.revoke,{projectId:p});await owner.mutation(api.storage.remove,{fileIds:[file.id]});
  expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(0);expect((await other.query(api.storage.summary,{})).usedBytes).toBe(300);expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').filter(q=>q.eq(q.field('name'),'r2:deleteObject')).collect())).toEqual([]);
});
test('multipart quota reserves concurrent uploads, converts completion once, and refunds aborts',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner'));await t.mutation(internal.storageMigration.ready,{});await asset(t,p,700);
  const first=await owner.action(api.r2.start,{projectId:p,fileName:'new.png',contentType:'image/png',kind:'image',size:200,width:10,height:10});
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({usedBytes:700,reservedBytes:200});
  await expect(owner.action(api.r2.start,{projectId:p,fileName:'too much.png',contentType:'image/png',kind:'image',size:200,width:10,height:10})).rejects.toThrow('cloud storage is full');
  const newId=await owner.action(api.r2.complete,{uploadId:first.uploadId,parts:[{partNumber:1,etag:'etag'}]});expect(newId).not.toBeNull();
  await owner.action(api.r2.complete,{uploadId:first.uploadId,parts:[{partNumber:1,etag:'etag'}]});
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({usedBytes:900,reservedBytes:0,fileCount:2});
  const pending=await owner.action(api.r2.start,{projectId:p,fileName:'last.png',contentType:'image/png',kind:'image',size:100,width:10,height:10});await owner.action(api.r2.abort,{uploadId:pending.uploadId});expect((await owner.query(api.storage.summary,{})).reservedBytes).toBe(0);
});
test('native storage attachment obeys the same quota and thumbnail bytes are counted without exposing auxiliary files',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner')),id=await asset(t,p,995);await t.mutation(internal.storageMigration.ready,{});
  const stored=await t.run(async ctx=>{const storageId=await ctx.storage.store(new Blob(['1234567890'],{type:'image/jpeg'}));/* mock metadata mirrors a real upload */
    // @ts-expect-error Convex-test system metadata fixture.
    await ctx.db.patch(storageId,{contentType:'image/jpeg'});
    await ctx.db.insert('uploadTickets',{ownerId:'owner',projectId:p,token:'thumb',storageId,expiresAt:Date.now()+60000,consumed:false});return storageId;});
  await expect(owner.mutation(api.assets.attachThumbnail,{assetId:id,storageId:stored})).rejects.toThrow('cloud storage is full');
  vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','2000');await owner.mutation(api.assets.attachThumbnail,{assetId:id,storageId:stored});
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({usedBytes:1005,imageBytes:1005,fileCount:1});expect((await owner.query(api.storage.files,listing)).page).toHaveLength(1);
});
test('existing data backfills in bounded pages, deduplicates copies and measures old R2 exports without downloading',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner'));await asset(t,p,400,undefined,undefined,false);await asset(t,p,400,undefined,undefined,false);
  for(let i=0;i<25;i++)await asset(t,p,1,`media/owner/project/${i}`,'owner',false);
  await t.run(ctx=>ctx.db.insert('renderJobs',{ownerId:'owner',projectId:p,outputR2Key:'media/owner/project/export',status:'completed',createdAt:1,updatedAt:1}));
  vi.mocked(fetch).mockResolvedValue(new Response(null,{headers:{'content-length':'200'}}));
  await t.action(internal.storageMigration.initialize,{});expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/read?token='),expect.objectContaining({method:'HEAD'}));
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({ready:true,usedBytes:625,imageBytes:425,exportBytes:200,fileCount:27});
  await t.action(internal.storageMigration.initialize,{});expect(fetch).toHaveBeenCalledOnce();expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(625);
  const files=(await owner.query(api.storage.files,{...listing,kind:'export'})).page;expect(files).toHaveLength(1);await owner.mutation(api.storage.remove,{fileIds:[files[0].id]});expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(425);
});
test('filters, search, sort, and pagination stay scoped to the signed-in account',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner')),otherP=await project(t,'other');await asset(t,p,100,'media/owner/project/small');await asset(t,p,900,'media/owner/project/large');await asset(t,otherP,999,'media/other/project/private','other');
  const first=await owner.query(api.storage.files,{...listing,paginationOpts:{cursor:null,numItems:1}});expect(first.page[0].size).toBe(900);expect(first.isDone).toBe(false);
  const next=await owner.query(api.storage.files,{...listing,paginationOpts:{cursor:first.continueCursor,numItems:1}});expect(next.page[0].size).toBe(100);
  expect((await owner.query(api.storage.files,{...listing,search:'large'})).page.map(f=>f.fileName)).toEqual(['large.png']);expect((await owner.query(api.storage.files,{...listing,kind:'audio'})).page).toEqual([]);expect((await owner.query(api.storage.files,{...listing,search:'private'})).page).toEqual([]);
});
test('simultaneous uploads cannot both reserve the last available bytes',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner'));await asset(t,p,700);await t.mutation(internal.storageMigration.ready,{});
  const outcomes=await Promise.allSettled([1,2].map(n=>owner.action(api.r2.start,{projectId:p,fileName:`${n}.png`,kind:'image',contentType:'image/png',width:10,height:10,size:200})));
  expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(outcome=>outcome.status==='rejected')).toHaveLength(1);
  expect((await owner.query(api.storage.summary,{}))).toMatchObject({usedBytes:700,reservedBytes:200});
});
test('abandoned native uploads expire without requiring another upload request',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner'));vi.stubEnv('CONVEX_SITE_URL','https://fixture.convex.site');
  const url=await owner.mutation(api.assets.generateUploadUrl,{projectId:p}),token=new URL(url).searchParams.get('ticket')!;
  const {ticketId}=await t.mutation(internal.uploads.reserve,{token});const storageId=await t.run(ctx=>ctx.storage.store(new Blob(['abandoned'])));
  await t.mutation(internal.uploads.finish,{ticketId,storageId});expect((await owner.query(api.storage.summary,{})).reservedBytes).toBe(9);
  await t.finishAllScheduledFunctions(vi.runAllTimers);expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();expect((await owner.query(api.storage.summary,{})).reservedBytes).toBe(0);
});
test('temporary R2 deletion failures retry before leaving an orphan behind',async()=>{
  const t=make(),p=await project(t),owner=t.withIdentity(identity('owner'));await asset(t,p);const file=(await owner.query(api.storage.files,listing)).page[0];
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:502})).mockResolvedValueOnce(Response.json({ok:true}));
  await owner.mutation(api.storage.remove,{fileIds:[file.id]});await t.finishAllScheduledFunctions(vi.runAllTimers);expect(fetch).toHaveBeenCalledTimes(2);expect((await owner.query(api.storage.summary,{})).usedBytes).toBe(0);
});
