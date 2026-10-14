/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
const modules=import.meta.glob('./**/*.ts');
afterEach(()=>vi.unstubAllEnvs());
async function fixture(){
  vi.stubEnv('BILLING_ENABLED','false');const t=convexTest(schema,modules);
  const data=await t.run(async ctx=>{
    const projectId=await ctx.db.insert('projects',{ownerId:'owner',title:'Thumbnail',aspectRatio:'landscape',createdAt:0,updatedAt:0});
    const assetId=await ctx.db.insert('assets',{ownerId:'owner',projectId,kind:'video',fileName:'video.mp4',contentType:'video/mp4',size:10,duration:2,createdAt:0});
    const storageId=await ctx.storage.store(new Blob(['jpeg'],{type:'image/jpeg'}));
    // convex-test omits MIME metadata supplied by real uploads.
    // @ts-expect-error Fixture-only system metadata.
    await ctx.db.patch(storageId,{contentType:'image/jpeg'});
    await ctx.db.insert('uploadTickets',{ownerId:'owner',projectId,storageId,token:'upload-ticket',expiresAt:Date.now()+60000,consumed:false});
    return {assetId,projectId,storageId};
  });return {t,...data,owner:t.withIdentity({subject:'owner'}),other:t.withIdentity({subject:'other'})};
}
test('saves the authorized source thumbnail and returns its image URL',async()=>{
  const {owner,t,assetId,projectId,storageId}=await fixture();await owner.mutation(api.assets.attachThumbnail,{assetId,storageId});
  const asset=await owner.query(api.assets.get,{projectId,assetId});expect(asset.thumbnailStorageId).toBe(storageId);expect(asset.thumbnailUrl).toBe(await t.run(ctx=>ctx.storage.getUrl(storageId)));
  expect(await t.run(ctx=>ctx.db.query('uploadTickets').withIndex('by_storageId',q=>q.eq('storageId',storageId)).first())).toBeNull();
});
test('cannot attach another user’s thumbnail or an unbound storage object',async()=>{
  const {owner,other,t,assetId,storageId}=await fixture();await expect(other.mutation(api.assets.attachThumbnail,{assetId,storageId})).rejects.toThrow('Media not found');
  const unbound=await t.run(async ctx=>{const id=await ctx.storage.store(new Blob(['jpeg'],{type:'image/jpeg'}));
    // @ts-expect-error Fixture-only system metadata.
    await ctx.db.patch(id,{contentType:'image/jpeg'});return id;});await expect(owner.mutation(api.assets.attachThumbnail,{assetId,storageId:unbound})).rejects.toThrow('does not belong');
});
test('reclaims the stored thumbnail when its last source attachment is deleted',async()=>{
  const {owner,t,assetId,storageId}=await fixture();await owner.mutation(api.assets.attachThumbnail,{assetId,storageId});await owner.mutation(api.assets.remove,{assetId});
  expect(await t.run(ctx=>ctx.storage.get(storageId))).toBeNull();
});
