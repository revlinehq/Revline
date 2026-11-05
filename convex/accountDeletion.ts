import { v } from 'convex/values';
import schema from './schema';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { beginProjectDeletion } from './projects';
import { stopOwnedProject } from './assistant';
import { releaseMediaObjects } from './lib/shared_media';
import { cancelMediaTask } from './lib/media_queue';

function isTable(name: string): name is TableNames { return Object.hasOwn(schema.tables, name); }
const tables = Object.keys(schema.tables).filter(isTable).filter(name => name !== 'accountDeletions' && name !== 'accountDeletionRefs');
const referenceKeys = ['projectId', 'assetId', 'sourceAssetId', 'jobId', 'shareId', 'threadId', 'derivationId', 'taskId', 'runId', 'kitId', 'snapshotId'];

async function remember(ctx: MutationCtx, ownerId: string, resourceId: string) {
  if (!await ctx.db.query('accountDeletionRefs').withIndex('by_owner_resource', q => q.eq('ownerId', ownerId).eq('resourceId', resourceId)).unique()) {
    await ctx.db.insert('accountDeletionRefs', { ownerId, resourceId });
  }
}

export const prepare = internalMutation({ args: { ownerId: v.string() }, returns: v.null(), handler: async (ctx, { ownerId }) => {
  const existing = await ctx.db.query('accountDeletions').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (!existing) await ctx.db.insert('accountDeletions', { ownerId, phase: 'pending', table: 0, cursor: null, changed: false, requestedAt: Date.now() });
  return null;
} });
export const activate = internalMutation({ args: { ownerId: v.string() }, returns: v.null(), handler: async (ctx, { ownerId }) => {
  const row = await ctx.db.query('accountDeletions').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (row && row.phase === 'pending') {
    await ctx.db.patch(row._id, { phase: 'projects' });
    await ctx.scheduler.runAfter(0, internal.accountDeletion.batch, { ownerId });
  }
  return null;
} });
export const abort = internalMutation({ args: { ownerId: v.string() }, returns: v.null(), handler: async (ctx, { ownerId }) => {
  const row = await ctx.db.query('accountDeletions').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (row?.phase === 'pending') await ctx.db.delete(row._id);
  return null;
} });

/** Bounded sweeps remove owned records and their descendants, including records
 * with only a project/share/job foreign key. References survive until completion. */
export const batch = internalMutation({ args: { ownerId: v.string() }, returns: v.null(), handler: async (ctx, { ownerId }) => {
  const job = await ctx.db.query('accountDeletions').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
  if (!job || job.phase === 'pending') return null;
  const again = (delay = 0) => ctx.scheduler.runAfter(delay, internal.accountDeletion.batch, { ownerId });
  if (job.phase === 'projects') {
    const tokens = await ctx.db.query('mcpTokens').withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(50);
    if (tokens.length) { for (const token of tokens) await ctx.db.delete(token._id); await again(); return null; }
    const project = await ctx.db.query('projects').withIndex('by_ownerId_updatedAt', q => q.eq('ownerId', ownerId)).first();
    if (project) {
      await remember(ctx, ownerId, project._id);
      if (project.threadId) await remember(ctx, ownerId, project.threadId);
      const activeExports = await Promise.all((['queued', 'rendering'] as const).map(status => ctx.db.query('renderJobs').withIndex('by_owner_project_status', q => q.eq('ownerId', ownerId).eq('projectId', project._id).eq('status', status)).take(20)));
      for (const render of activeExports.flat()) {
        if (render.taskId) await cancelMediaTask(ctx, render.taskId);
        await ctx.db.patch(render._id, { status: 'cancelled', updatedAt: Date.now() });
      }
      if (activeExports.some(rows => rows.length)) { await again(); return null; }
      await stopOwnedProject(ctx, project);
      await beginProjectDeletion(ctx, ownerId, { ...project, aiRunning: false });
      await again(2000); return null;
    }
    await ctx.db.patch(job._id, { phase: 'rows' }); await again(); return null;
  }
  const table = tables[job.table];
  if (!table) {
    if (job.changed) {
      await ctx.db.patch(job._id, { table: 0, cursor: null, changed: false }); await again(); return null;
    }
    if(await ctx.db.query('r2Uploads').withIndex('by_owner_completed',q=>q.eq('ownerId',ownerId).eq('completed',false)).first()){await again(60_000);return null;}
    if(await ctx.db.query('cloudMedia').withIndex('by_owner_completed',q=>q.eq('ownerId',ownerId).eq('completed',false)).first()){await again(60_000);return null;}
    const refs = await ctx.db.query('accountDeletionRefs').withIndex('by_owner_resource', q => q.eq('ownerId', ownerId)).take(100);
    if (refs.length) { for (const ref of refs) await ctx.db.delete(ref._id); await again(); return null; }
    const subjectHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ownerId))),b=>b.toString(16).padStart(2,'0')).join('');
    const existing=await ctx.db.query('deletedAccountTokens').withIndex('by_hash',q=>q.eq('subjectHash',subjectHash)).unique();
    if(!existing)await ctx.db.insert('deletedAccountTokens',{subjectHash,expiresAt:Date.now()+48*3600_000});
    await ctx.db.delete(job._id);
    await ctx.scheduler.runAfter(48*3600_000,internal.accountDeletion.expireTokens,{});
    return null;
  }
  const page = await ctx.db.query(table).paginate({ cursor: job.cursor, numItems: 50 });
  let changed = job.changed;
  for (const row of page.page) {
    if('ownerId' in row && row.ownerId !== undefined && row.ownerId !== ownerId)continue;
    if('clerkId' in row && row.clerkId !== ownerId)continue;
    let owned = 'ownerId' in row && row.ownerId === ownerId || 'clerkId' in row && row.clerkId === ownerId;
    if (!owned) {
      for (const key of referenceKeys) {
        const value = Reflect.get(row, key);
        if (typeof value === 'string' && await ctx.db.query('accountDeletionRefs').withIndex('by_owner_resource', q => q.eq('ownerId', ownerId).eq('resourceId', value)).unique()) { owned = true; break; }
      }
    }
    if (!owned) continue;
    if('resultStorageId' in row&&row.resultStorageId)await ctx.storage.delete(row.resultStorageId);
    if('cardStorageId' in row&&row.cardStorageId)await ctx.storage.delete(row.cardStorageId);
    await remember(ctx, ownerId, row._id);
    for (const key of ['threadId', 'runId']) {
      const value = Reflect.get(row, key);
      if (typeof value === 'string') await remember(ctx, ownerId, value);
    }
    if (table === 'cloudMedia' && !Reflect.get(row, 'completed')) {
      const id = ctx.db.normalizeId('cloudMedia',row._id);
      if(id)await ctx.scheduler.runAfter(0,internal.cloudMedia.cleanup,{uploadId:id,force:true});
      continue;
    }
    if (table === 'r2Uploads' && !Reflect.get(row, 'completed')) {
      const id = ctx.db.normalizeId('r2Uploads', row._id);
      if (id) await ctx.scheduler.runAfter(0, internal.r2.cleanupLease, { uploadId: id });
      continue;
    }
    await ctx.db.delete(row._id);
    if (table === 'brandKits' && 'fonts' in row) {
      for (const file of [...row.fonts, ...(row.screens ?? [])]) {
        await releaseMediaObjects(ctx, { storageId: file.storageId });
      }
    }
    if (table === 'assistantDisplayFiles' && 'storageIds' in row) {
      for (const value of row.storageIds ?? []) {
        const storageId = ctx.db.system.normalizeId('_storage', value);
        if (storageId) await releaseMediaObjects(ctx, { storageId });
      }
    }
    const storageId = Reflect.get(row, 'storageId') ?? Reflect.get(row, 'outputStorageId');
    const thumbnail = Reflect.get(row, 'thumbnailStorageId');
    const r2Key = Reflect.get(row, 'r2Key') ?? Reflect.get(row, 'outputR2Key') ?? (table === 'r2Uploads' ? Reflect.get(row, 'key') : undefined);
    const preview = Reflect.get(row, 'previewR2Key');
    await releaseMediaObjects(ctx, {
      ...(typeof storageId === 'string' ? { storageId: ctx.db.system.normalizeId('_storage', storageId) ?? undefined } : {}),
      ...(typeof thumbnail === 'string' ? { thumbnailStorageId: ctx.db.system.normalizeId('_storage', thumbnail) ?? undefined } : {}),
      ...(typeof r2Key === 'string' ? { r2Key } : {}),
      ...(typeof preview === 'string' ? { previewR2Key: preview } : {}),
    });
    changed = true;
  }
  await ctx.db.patch(job._id, { table: page.isDone ? job.table + 1 : job.table, cursor: page.isDone ? null : page.continueCursor, changed });
  await again(); return null;
} });

/** Keep no raw subject after cleanup; the short-lived hash only blocks old JWTs. */
export const expireTokens=internalMutation({args:{},returns:v.null(),handler:async ctx=>{
  const rows=await ctx.db.query('deletedAccountTokens').withIndex('by_expiry',q=>q.lte('expiresAt',Date.now())).take(100);
  for(const row of rows)await ctx.db.delete(row._id);
  if(rows.length===100)await ctx.scheduler.runAfter(0,internal.accountDeletion.expireTokens,{});
  return null;
}});
