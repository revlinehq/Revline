import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { parse } from 'convex-helpers/validators';
import { referenceReadResult } from './schema';
import { ConvexError, v, type Infer } from 'convex/values';
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireMediaTask } from './lib/media_task_auth';
import { mediaTaskCredentials } from './lib/media_task_contract';
import { projectIdentity } from './lib/project_data';
import { requireEditorAccess } from './lib/billing_access';
import { mediaConfig, mediaUrl } from './lib/media_storage';
import { signMediaToken, verifyMediaToken } from '../lib/storage/media-tokens';
import { frameCacheKey, referenceCacheScope, referenceResultDescriptor, type CacheScope } from '../lib/media-analysis/frame-cache';

const args = { ...mediaTaskCredentials, processorVersion:v.number(), output: v.any() };
const TTL = 14 * 86400_000;
async function taskScope(ctx: MutationCtx, credentials: { taskId: Id<'mediaTasks'>; leaseToken: string }): Promise<CacheScope> {
  const task = await requireMediaTask(ctx, credentials.taskId, credentials.leaseToken);
  if ((task.kind === 'read' || task.kind === 'highlights') && task.assetId) {
    const asset = await ctx.db.get(task.assetId);
    if (!asset || asset.ownerId !== task.ownerId || asset.projectId !== task.projectId) throw new ConvexError('Reference media was removed.');
    return referenceCacheScope(task.ownerId, task.projectId, asset);
  }
  if (task.kind === 'snapshot' && task.snapshotId) {
    const snapshot = await ctx.db.get(task.snapshotId);
    if (snapshot?.cacheIdentity) return { ownerId: task.ownerId, projectId: task.projectId };
  }
  throw new ConvexError('This task cannot cache frames.');
}

/** One small row per object, never pixels or analysis arrays. Reservations coalesce concurrent decodes. */
async function writableReservation(key:string,r2Key:string) {
  const {url,secret}=mediaConfig();
  const token=await signMediaToken(secret,{operation:'cacheWrite',key:r2Key,expires:Date.now()+15*60_000});
  return {state:'miss',key,r2Key,uploadToken:token,uploadUrl:`${url}/cache?token=${token}`};
}
async function reserveOutput(ctx:MutationCtx, scope:CacheScope, credentials:{taskId:Id<'mediaTasks'>;leaseToken:string}, output:unknown) {
  const key = await frameCacheKey(scope, output);
  let entry = await ctx.db.query('mediaFrameCache').withIndex('by_key', q => q.eq('key', key)).unique();
  if (entry && entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) { await removeEntry(ctx, entry); entry = null; }
  if (entry?.ready) return { state: 'hit', key, r2Key:entry.r2Key, url: await mediaUrl(ctx, entry) };
  if (entry) {
    const writer = entry.taskId ? await ctx.db.get(entry.taskId) : null;
    if (writer && writer.leaseToken === entry.leaseToken && writer.status === 'running' && (writer.leaseExpiresAt ?? 0) > Date.now()) {
      // A reserve response may be lost after commit. The same lease must recover
      // its reservation instead of waiting on itself until the decode deadline.
      if(entry.taskId===credentials.taskId&&entry.leaseToken===credentials.leaseToken)return writableReservation(key,entry.r2Key);
      return {state:'wait',key};
    }
    await removeEntry(ctx, entry);
  }
  const timeline = !scope.assetId || (output as {kind?:string})?.kind === 'reference-result' && (output as {mode?:string})?.mode === 'compare';
  const r2Key = `media/${scope.ownerId}/${scope.projectId}/cache-${crypto.randomUUID()}`;
  await ctx.db.insert('mediaFrameCache', { key, r2Key, ownerId: scope.ownerId, projectId: scope.projectId as Id<'projects'>, ...(scope.assetId ? { assetId: scope.assetId as Id<'assets'> } : {}), ...(timeline ? {expiresAt:Date.now()+TTL} : {}), timeline, taskId: credentials.taskId, leaseToken: credentials.leaseToken, ready: false });
  return writableReservation(key,r2Key);
}
function processorVersion(version:number) {
  if (version !== MEDIA_PROCESSOR_VERSION) throw new ConvexError('The frame cache and media processor must use the same release.');
}
export const reserve = mutation({ args, returns:v.any(), handler:async(ctx,input)=>{
  processorVersion(input.processorVersion);
  return reserveOutput(ctx,await taskScope(ctx,input),input,input.output);
}});
/** Reserve a whole capture atomically: overlapping batches cannot each hold half the frames and wait on each other. */
export const reserveBatch = mutation({args:{...mediaTaskCredentials,processorVersion:v.number(),outputs:v.array(v.any())},returns:v.any(),handler:async(ctx,input)=>{
  processorVersion(input.processorVersion);
  if (!input.outputs.length || input.outputs.length > 30) throw new ConvexError('Cache up to 30 frames at a time.');
  const scope=await taskScope(ctx,input),reservations=[];
  for(const output of input.outputs)reservations.push(await reserveOutput(ctx,scope,input,output));
  return reservations;
}});
export const evict = mutation({ args: { ...args, key: v.string(), r2Key:v.string() }, returns: v.null(), handler: async (ctx, args) => {
  processorVersion(args.processorVersion);
  const scope = await taskScope(ctx, args);
  if (await frameCacheKey(scope, args.output) !== args.key) throw new ConvexError('Invalid cache key.');
  const entry = await ctx.db.query('mediaFrameCache').withIndex('by_key', q => q.eq('key', args.key)).unique();
  if (entry?.r2Key === args.r2Key) await removeEntry(ctx, entry);
  return null;
}});
export const finish = mutation({ args: { ...mediaTaskCredentials, key: v.string(), r2Key: v.string(), uploadToken: v.string(), failed: v.optional(v.boolean()) }, returns: v.boolean(), handler: async (ctx, args) => {
  const grant = await verifyMediaToken(mediaConfig().secret, args.uploadToken);
  if (grant?.operation !== 'cacheWrite' || grant.key !== args.r2Key) throw new ConvexError('Invalid cache publication grant.');
  const entry = await ctx.db.query('mediaFrameCache').withIndex('by_key', q => q.eq('key', args.key)).unique();
  if (entry?.ready && entry.r2Key === args.r2Key) return true;
  // An asset/project deletion may have won while the PUT was in flight. Delete again after it finishes.
  if (!entry || entry.r2Key !== args.r2Key || entry.taskId !== args.taskId || entry.leaseToken !== args.leaseToken) { await ctx.scheduler.runAfter(0, internal.r2.deleteObject, { key: args.r2Key }); return false; }
  let valid = false;
  try { await taskScope(ctx, args); valid = !args.failed; } catch { /* Deleted source or expired worker lease. */ }
  if (!valid) { await removeEntry(ctx, entry); return false; }
  await ctx.db.patch(entry._id, { ready: true, taskId: undefined, leaseToken: undefined });
  return true;
}});

export const referenceLookup = internalQuery({ args: { ownerId: v.string(), projectId: v.id('projects'), assetId: v.string(), snapshotId: v.optional(v.id('frameSnapshots')), work: v.any() }, returns: v.any(), handler: async (ctx, args) => {
  await requireEditorAccess(ctx, args.ownerId);
  await projectIdentity(ctx, args.projectId, args.ownerId);
  const id = ctx.db.normalizeId('assets', args.assetId), asset = id ? await ctx.db.get(id) : null;
  if (!asset || asset.ownerId !== args.ownerId || asset.projectId !== args.projectId) throw new ConvexError('That media is not in this project.');
  let work = args.work;
  if (work.mode === 'compare') {
    const snapshot = args.snapshotId ? await ctx.db.get(args.snapshotId) : null;
    if (!snapshot || snapshot.ownerId !== args.ownerId || snapshot.projectId !== args.projectId || snapshot.status !== 'completed' || !snapshot.cacheIdentity) return null;
    work = {...work, comparisonIdentity:snapshot.cacheIdentity};
  }
  const key = await frameCacheKey(referenceCacheScope(args.ownerId, args.projectId, asset), referenceResultDescriptor(work));
  const entry = await ctx.db.query('mediaFrameCache').withIndex('by_key', q => q.eq('key', key)).unique();
  return entry?.ready && (entry.expiresAt === undefined || entry.expiresAt > Date.now()) ? { key, r2Key: entry.r2Key, url: await mediaUrl(ctx, entry) } : null;
}});
export const invalidate = internalMutation({ args: { key: v.string(), r2Key: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const entry = await ctx.db.query('mediaFrameCache').withIndex('by_key', q => q.eq('key', args.key)).unique();
  if (entry?.r2Key === args.r2Key) await removeEntry(ctx, entry);
  return null;
}});
export const readResult = internalAction({ args: { ownerId: v.string(), projectId: v.id('projects'), assetId: v.string(), snapshotId: v.optional(v.id('frameSnapshots')), work: v.any() }, returns: v.union(referenceReadResult,v.null()), handler: async (ctx, args):Promise<Infer<typeof referenceReadResult>|null> => {
  const cached = await ctx.runQuery(internal.frameCache.referenceLookup, args);
  if (!cached?.url) return null;
  try {
    const response = await fetch(cached.url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new Error('Cached object unavailable');
    const value = parse(referenceReadResult, await response.json());
    console.info('[frame-cache]', { kind: 'reference-result', outcome: 'hit', projectId: args.projectId });
    return value;
  } catch { await ctx.runMutation(internal.frameCache.invalidate, { key: cached.key, r2Key: cached.r2Key }); return null; }
}});
async function removeEntry(ctx: MutationCtx, entry: Doc<'mediaFrameCache'>) {
  await ctx.db.delete(entry._id);
  await ctx.scheduler.runAfter(0, internal.r2.deleteObject, { key: entry.r2Key });
  // A PUT that started before deletion can outlive the first delete. Task deadlines and grants end at 15 minutes.
  if (!entry.ready) await ctx.scheduler.runAfter(16 * 60_000, internal.r2.deleteObject, {key:entry.r2Key});
}
export async function removeFrameCacheBatch(ctx: MutationCtx, projectId: Id<'projects'>, assetId?: Id<'assets'>) {
  let entries = await (assetId ? ctx.db.query('mediaFrameCache').withIndex('by_asset', q => q.eq('assetId', assetId)) : ctx.db.query('mediaFrameCache').withIndex('by_project', q => q.eq('projectId', projectId))).take(50);
  // A removed source must not remain visible in an old render or comparison sheet.
  if (assetId && !entries.length) entries = await ctx.db.query('mediaFrameCache').withIndex('by_project_timeline',q=>q.eq('projectId',projectId).eq('timeline',true)).take(50);
  for (const entry of entries) await removeEntry(ctx, entry);
  return entries.length > 0;
}
export const removeAsset = internalMutation({ args: { projectId: v.id('projects'), assetId: v.id('assets') }, returns: v.null(), handler: async (ctx, args) => {
  if (await removeFrameCacheBatch(ctx, args.projectId, args.assetId)) await ctx.scheduler.runAfter(0, internal.frameCache.removeAsset, args);
  return null;
}});
export const prune = internalMutation({ args: {}, returns: v.null(), handler: async ctx => {
  const entries = await ctx.db.query('mediaFrameCache').withIndex('by_expiry', q => q.gt('expiresAt', 0).lte('expiresAt', Date.now())).take(100);
  for (const entry of entries) await removeEntry(ctx, entry);
  if (entries.length === 100) await ctx.scheduler.runAfter(0, internal.frameCache.prune, {});
  return null;
}});
