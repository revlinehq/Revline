import { writeProject,readProject } from './lib/project_data';
import { completeDeletion } from '../lib/test-support/convex-deletion';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import stripeTest from '@convex-dev/stripe/test';
import workflowTest from '@convex-dev/workflow/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Stripe from 'stripe';
import { api, components, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const identity = (subject: string) => ({ subject, issuer: 'https://audit.clerk.accounts.dev', tokenIdentifier: `audit|${subject}` });
const ownerId = 'user_auditowner';
const otherId = 'user_auditother';
const focus = [{ time: 0, x: .5, y: .5 }];

beforeEach(() => {
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_audit');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_audit');
  vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_audit');
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3001');
  vi.stubEnv('MEDIA_WORKER_URL', 'https://media.example.com');
  vi.stubEnv('MEDIA_SIGNING_SECRET', 'audit-signing-secret');
  vi.stubEnv('RENDER_WORKER_SECRET', 'audit-worker-secret');
  vi.stubEnv('CONVEX_SITE_URL', 'https://audit.convex.site');
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(body.action === 'create' ? { uploadId: 'multipart-audit' } : body.action === 'complete' ? { size: 10, contentType: 'video/mp4' } : {}));
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture(granted = true) {
  const t = convexTest(schema, modules); stripeTest.register(t); workflowTest.register(t);
  const owner = t.withIdentity(identity(ownerId)), other = t.withIdentity(identity(otherId));
  if (granted) await t.mutation(internal.editorAccess.grantComplimentary, { ownerId, reason: 'Owned audit fixture' });
  const data = await t.run(async ctx => {
    const projectId = await ctx.db.insert('projects', { ownerId, title: 'Private audit edit', aspectRatio: 'vertical', revision: 0, createdAt: 0, updatedAt: 0 });
    const assetId = await ctx.db.insert('assets', { ownerId, projectId, fileName: 'Private.mp4', contentType: 'video/mp4', kind: 'video', size: 10, duration: 3, createdAt: 0, analysis: { understanding: { summary: 'Private source notes', scenes: [] } } });
    const taskId = await ctx.db.insert('mediaTasks', { ownerId, projectId, assetId, kind: 'understand', status: 'completed', attempt: 1, progress: 100, createdAt: 0, updatedAt: 0 });
    const jobId = await ctx.db.insert('renderJobs', { ownerId, projectId, status: 'completed', createdAt: 0, updatedAt: 0 });
    return { projectId, assetId, taskId, jobId };
  });
  return { t, owner, other, ...data };
}
async function revoke(f: Awaited<ReturnType<typeof fixture>>, mode: 'revoked' | 'expired') {
  if (mode === 'revoked') await f.t.mutation(internal.editorAccess.revokeComplimentary, { ownerId });
  else await f.t.run(async ctx => {
    const entitlement = await ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', ownerId)).unique();
    await ctx.db.patch(entitlement!._id, { expiresAt: Date.now() - 1 });
  });
}
const upload = (f: Awaited<ReturnType<typeof fixture>>) => f.owner.action(api.r2.start, { projectId: f.projectId, kind: 'video', fileName: 'New.mp4', contentType: 'video/mp4', size: 10, duration: 3, width: 1080, height: 1920 });

test('multipart lease authorization reads identity without hydrating project history', async () => {
  const f=await fixture();
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{history:Array.from({length:10},(_,index)=>({fps:30,aspectRatio:'vertical' as const,clips:[{id:'caption',kind:'caption' as const,start:0,duration:1,sourceStart:0,text:`Revision ${index}`}]}))}));
  const {uploadId}=await upload(f),{getLease}=await import('./r2');
  const trace=await f.t.run(async ctx=>{
    const tables:string[]=[],reads:string[]=[];
    const db=new Proxy(ctx.db,{get(target,property,receiver){
      if(property==='query')return (...args:unknown[])=>{tables.push(String(args[0]));return Reflect.apply(target.query,target,args);};
      if(property==='get')return (...args:unknown[])=>{reads.push(String(args.at(-1)));return Reflect.apply(target.get,target,args);};
      return Reflect.get(target,property,receiver);
    }});
    const lease=await (getLease as unknown as {_handler:(ctx:unknown,args:unknown)=>Promise<{_id:string}>})._handler({...ctx,db,auth:{getUserIdentity:async()=>identity(ownerId)}},{uploadId});
    return {tables,reads,id:lease._id};
  });
  expect(trace.id).toBe(uploadId);expect(trace.tables).toContain('projectAccess');
  expect(trace.tables).not.toContain('timelineRevisions');expect(trace.tables).not.toContain('aiRuns');expect(trace.reads).not.toContain(f.projectId);
});

test.each(['revoked', 'expired'] as const)('%s complimentary access blocks direct focus writes', async mode => {
  const f = await fixture();
  await f.owner.mutation(api.assets.saveFocus, { projectId: f.projectId, assetId: f.assetId, focus });
  await revoke(f, mode);
  await expect(f.owner.mutation(api.assets.saveFocus, { projectId: f.projectId, assetId: f.assetId, focus: [{ time: 0, x: .8, y: .2 }] })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect((await f.owner.query(api.assets.get,{projectId:f.projectId,assetId:f.assetId})).analysis?.focus).toEqual(focus);
});

test.each(['revoked', 'expired'] as const)('%s access blocks new multipart part URLs and attachment through an old lease', async mode => {
  const f = await fixture(), { uploadId } = await upload(f);
  await expect(f.owner.action(api.r2.partUrl, { uploadId, partNumber: 1 })).resolves.toContain('/part?token=');
  await revoke(f, mode);
  await expect(f.owner.action(api.r2.partUrl, { uploadId, partNumber: 1 })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await expect(f.owner.action(api.r2.complete, { uploadId, parts: [{ partNumber: 1, etag: 'fixture-etag' }] })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect(await f.t.run(ctx => ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', f.projectId)).collect())).toHaveLength(1);
  expect(await f.t.run(ctx => ctx.db.query('mediaTasks').withIndex('by_project_createdAt', q => q.eq('projectId', f.projectId)).collect())).toHaveLength(1);
  await expect(f.owner.action(api.r2.abort, { uploadId })).resolves.toBeNull();
  expect(await f.t.run(ctx => ctx.db.get(uploadId))).toBeNull();
});

test('multipart final attachment rechecks access after the external completion request', async () => {
  const f = await fixture(), { uploadId } = await upload(f);
  const lease=(await f.t.run(ctx=>ctx.db.get(uploadId)))!,objects=new Set<string>();
  vi.mocked(fetch).mockImplementation(async (_url,init) => {
    const body=JSON.parse(String(init?.body));
    if(body.action==='complete'){
      objects.add(body.key);
      await f.t.mutation(internal.editorAccess.revokeComplimentary, { ownerId });
      return Response.json({ size: 10, contentType: 'video/mp4' });
    }
    // R2 cannot abort a multipart upload after its object was completed.
    if(body.action==='delete')objects.delete(body.key);
    return Response.json({});
  });
  await expect(f.owner.action(api.r2.complete, { uploadId, parts: [{ partNumber: 1, etag: 'fixture-etag' }] })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect((await f.t.run(ctx => ctx.db.get(uploadId)))?.completed).toBe(false);
  expect(objects.has(lease.key)).toBe(true);
  await f.owner.action(api.r2.abort,{uploadId});
  expect(objects.has(lease.key)).toBe(false);
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toBeNull();
  expect((await f.owner.query(api.storage.summary,{})).reservedBytes).toBe(0);
});

test('a completed attachment wins an abort claim without deleting its saved object',async()=>{
  const f=await fixture(),{uploadId}=await upload(f),lease=(await f.t.run(ctx=>ctx.db.get(uploadId)))!;
  const assetId=await f.owner.action(api.r2.complete,{uploadId,parts:[{partNumber:1,etag:'fixture-etag'}]});
  vi.mocked(fetch).mockClear();
  await f.owner.action(api.r2.abort,{uploadId});
  await f.t.action(internal.r2.cleanupLease,{uploadId});
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  expect((await f.t.run(ctx=>ctx.db.get(assetId!)))?.r2Key).toBe(lease.key);
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toBeNull();
});

test('an abort claim blocks an in-flight completion from attaching the deleted object',async()=>{
  const f=await fixture(),{uploadId}=await upload(f);
  let signalComplete!:()=>void,releaseComplete!:()=>void,signalDelete!:()=>void,releaseDelete!:()=>void;
  const completing=new Promise<void>(resolve=>{signalComplete=resolve;}),allowComplete=new Promise<void>(resolve=>{releaseComplete=resolve;});
  const deleting=new Promise<void>(resolve=>{signalDelete=resolve;}),allowDelete=new Promise<void>(resolve=>{releaseDelete=resolve;});
  vi.mocked(fetch).mockImplementation(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(body.action==='complete'){signalComplete();await allowComplete;return Response.json({size:10,contentType:'video/mp4'});}
    if(body.action==='delete'){signalDelete();await allowDelete;}
    return Response.json({});
  });
  const complete=f.owner.action(api.r2.complete,{uploadId,parts:[{partNumber:1,etag:'fixture-etag'}]});
  const refused=expect(complete).rejects.toThrow('being removed');
  await completing;
  const abort=f.owner.action(api.r2.abort,{uploadId});
  await deleting;
  expect((await f.t.run(ctx=>ctx.db.get(uploadId)))?.aborting).toBe(true);
  await expect(f.owner.action(api.r2.partUrl,{uploadId,partNumber:1})).rejects.toThrow('being removed');
  releaseComplete();await refused;
  releaseDelete();await abort;
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toBeNull();
  expect(await f.owner.query(api.assets.list,{projectId:f.projectId})).toHaveLength(1);
});

test('failed object deletion retains its abort claim and reservation for scheduled retry',async()=>{
  const f=await fixture(),{uploadId}=await upload(f),lease=(await f.t.run(ctx=>ctx.db.get(uploadId)))!;
  vi.mocked(fetch).mockImplementation(async(_url,init)=>JSON.parse(String(init?.body)).action==='delete'?new Response('Unavailable',{status:503}):Response.json({}));
  await expect(f.owner.action(api.r2.abort,{uploadId})).rejects.toThrow('Cloudflare media request failed');
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toMatchObject({aborting:true,completed:false});
  expect((await f.owner.query(api.storage.summary,{})).reservedBytes).toBe(lease.size);
  await f.t.action(internal.r2.cleanupLease,{uploadId});
  const scheduled=await f.t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
  expect(scheduled.some(row=>row.name==='r2:cleanupLease'&&(row.args[0] as {attempt?:number}).attempt===1)).toBe(true);
  vi.mocked(fetch).mockImplementation(async()=>Response.json({}));
  await f.t.action(internal.r2.cleanupLease,{uploadId,attempt:1});
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toBeNull();
  expect((await f.owner.query(api.storage.summary,{})).reservedBytes).toBe(0);
});

test('private queries, mutations, uploads and playback reject signed-out and other paid users', async () => {
  const f = await fixture();
  await f.t.mutation(internal.editorAccess.grantComplimentary, { ownerId: otherId, reason: 'Independent audit fixture' });
  const { uploadId } = await upload(f);
  for (const client of [f.t, f.other]) {
    const blocked = [
      client.query(api.projects.get, { projectId: f.projectId }),
      client.query(api.assets.list, { projectId: f.projectId }),
      client.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId }),
      client.query(api.assistant.status, { projectId: f.projectId }),
      client.query(api.assistant.messages, { projectId: f.projectId, threadId: 'private-thread', paginationOpts: { numItems: 10, cursor: null }, streamArgs: undefined }),
      client.query(api.mediaTasks.get, { taskId: f.taskId }),
      client.query(api.mediaTasks.list, { projectId: f.projectId }),
      client.query(api.renders.get, { jobId: f.jobId }),
      client.query(api.renders.list, { projectId: f.projectId }),
      client.query(api.timelineShares.status, { projectId: f.projectId }),
      client.action(api.playback.refresh, { projectId: f.projectId, assetIds: [f.assetId] }),
      client.mutation(api.projects.update, { projectId: f.projectId, title: 'Hijacked' }),
      client.mutation(api.projects.remove, { projectId: f.projectId }),
      client.mutation(api.assets.remove, { assetId: f.assetId }),
      client.mutation(api.assets.saveFocus, { projectId: f.projectId, assetId: f.assetId, focus }),
      client.mutation(api.assets.generateUploadUrl, { projectId: f.projectId }),
      client.mutation(api.mediaTasks.start, { projectId: f.projectId, assetId: f.assetId, kind: 'understand' }),
      client.mutation(api.assistant.send, { projectId: f.projectId, prompt: 'Edit private material' }),
      client.mutation(api.renders.start, { projectId: f.projectId, resolution: 720, fps: 30, quality: 'draft' }),
      client.mutation(api.timelineShares.publish, { projectId: f.projectId }),
      client.mutation(api.timelineShares.revoke, { projectId: f.projectId }),
      client.action(api.r2.partUrl, { uploadId, partNumber: 1 }),
      client.action(api.r2.complete, { uploadId, parts: [{ partNumber: 1, etag: 'fixture-etag' }] }),
      client.action(api.r2.abort, { uploadId }),
    ];
    const results = await Promise.allSettled(blocked);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
  }
  expect(await f.other.query(api.assets.selected, { assetIds: [f.assetId] })).toEqual([]);
  expect(await f.other.query(api.assets.library, { paginationOpts: { numItems: 10, cursor: null } })).toMatchObject({ page: [] });
  expect(await f.other.query(api.projects.list, {})).toEqual([]);
  expect((await f.owner.query(api.projects.get, { projectId: f.projectId })).title).toBe('Private audit edit');
});

test('expired subscriptions block direct focus edits and multipart continuation', async () => {
  const f = await fixture(false);
  const stripeSubscriptionId = 'sub_audit';
  await f.t.mutation(components.stripe.private.handleSubscriptionCreated, { stripeSubscriptionId, stripeCustomerId: 'cus_audit', priceId: 'price_audit', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600, cancelAtPeriodEnd: false, metadata: { userId: ownerId } });
  const { uploadId } = await upload(f);
  await f.t.mutation(components.stripe.private.handleSubscriptionUpdated, { stripeSubscriptionId, status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) - 1, cancelAtPeriodEnd: false });
  await expect(f.owner.mutation(api.assets.saveFocus, { projectId: f.projectId, assetId: f.assetId, focus })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await expect(f.owner.action(api.r2.partUrl, { uploadId, partNumber: 1 })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});

test('expired accounts retain owned read, share revocation and media cleanup', async () => {
  const f = await fixture();
  await f.t.run(ctx => writeProject(ctx,f.projectId, { timeline: { fps: 30, aspectRatio: 'vertical', clips: [{ id: 'title', kind: 'graphic', text: 'Published title', start: 0, duration: 2, sourceStart: 0 }] } }));
  const shareId = await f.owner.mutation(api.timelineShares.publish, { projectId: f.projectId });
  expect(await f.t.query(api.timelineShares.get, { shareId })).toMatchObject({ title: 'Private audit edit' });
  await revoke(f, 'revoked');
  await expect(f.owner.query(api.assets.get, { projectId: f.projectId, assetId: f.assetId })).resolves.toMatchObject({ ownerId });
  await expect(f.owner.query(api.projects.get, { projectId: f.projectId })).resolves.toMatchObject({ ownerId });
  await expect(f.owner.mutation(api.timelineShares.publish, { projectId: f.projectId })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await expect(f.owner.mutation(api.timelineShares.useTimeline, { shareId })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await f.owner.mutation(api.timelineShares.revoke, { projectId: f.projectId });
  expect(await f.t.query(api.timelineShares.get, { shareId })).toBeNull();
  await f.owner.mutation(api.assets.remove, { assetId: f.assetId });
  await f.owner.mutation(api.projects.remove, { projectId: f.projectId });await completeDeletion(f.t, f.projectId);
  expect(await f.t.run(ctx => readProject(ctx,f.projectId))).toBeNull();
});

test('a user cannot reuse a worker upload lease without the active task credentials', async () => {
  const f = await fixture();
  const leaseToken = 'owned-task-capability';
  await f.t.run(ctx => ctx.db.patch(f.taskId, { kind: 'extract', status: 'running', leaseToken, leaseExpiresAt: Date.now() + 60_000 }));
  const { uploadId } = await f.t.action(api.r2.start, { projectId: f.projectId, taskId: f.taskId, leaseToken, kind: 'audio', fileName: 'Output.m4a', contentType: 'audio/mp4', size: 10 });
  await expect(f.owner.action(api.r2.partUrl, { uploadId, partNumber: 1 })).rejects.toThrow('Upload belongs to another task attempt');
  await expect(f.owner.action(api.r2.complete, { uploadId, parts: [{ partNumber: 1, etag: 'fixture-etag' }] })).rejects.toThrow('Upload belongs to another task attempt');
  await revoke(f, 'revoked');
  await expect(f.t.action(api.r2.partUrl, { uploadId, partNumber: 1, taskId: f.taskId, leaseToken })).resolves.toContain('/part?token=');
  await f.t.run(ctx => ctx.db.patch(f.taskId, { leaseExpiresAt: Date.now() - 1 }));
  await expect(f.t.action(api.r2.partUrl, { uploadId, partNumber: 1, taskId: f.taskId, leaseToken })).rejects.toThrow('lease is no longer active');
});

test('native upload tickets cannot accept new files after editor access is revoked', async () => {
  const f = await fixture();
  const url = await f.owner.mutation(api.assets.generateUploadUrl, { projectId: f.projectId });
  const token = new URL(url).searchParams.get('ticket')!;
  await revoke(f, 'revoked');
  await expect(f.t.mutation(internal.uploads.reserve, { token })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});

test('native upload completion rechecks access after receiving the file', async () => {
  const f = await fixture();
  const url = await f.owner.mutation(api.assets.generateUploadUrl, { projectId: f.projectId });
  const token = new URL(url).searchParams.get('ticket')!;
  const { ticketId } = await f.t.mutation(internal.uploads.reserve, { token });
  const storageId = await f.t.run(ctx => ctx.storage.store(new Blob(['owned mock'], { type: 'video/mp4' })));
  await revoke(f, 'revoked');
  await expect(f.t.mutation(internal.uploads.finish, { ticketId, storageId })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect((await f.t.run(ctx => ctx.db.get(ticketId)))?.storageId).toBeUndefined();
});

test('signed subscription webhooks cannot revive canceled access when delivered out of order', async () => {
  const f = await fixture(false), stripe = new Stripe('sk_test_audit');
  let current: object;
  const requests = vi.spyOn(Stripe.StripeResource.prototype, '_makeRequest').mockImplementation(async (method, path) => {
    expect(method).toBe('GET'); expect(path).toBe('/v1/subscriptions/sub_ordered_audit');
    return current as never;
  });
  const send = async (id: string, created: number, type: string, status: string, currentStatus = status) => {
    const object = { id: 'sub_ordered_audit', customer: 'cus_audit', status, cancel_at_period_end: false, metadata: { userId: ownerId, app: 'revline-editor' }, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 3600, quantity: 1, price: { id: 'price_audit' } }] } };
    current = { ...object, status: currentStatus };
    const payload = JSON.stringify({ id, created, type, data: { object } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_audit' });
    expect((await f.t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } })).status).toBe(200);
  };
  await send('evt_create', 100, 'customer.subscription.created', 'active');
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(true);
  await send('evt_cancel', 300, 'customer.subscription.deleted', 'canceled');
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(false);
  await send('evt_old_active', 200, 'customer.subscription.updated', 'active', 'canceled');
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(false);
  const count = requests.mock.calls.length;
  await send('evt_old_active', 200, 'customer.subscription.updated', 'active', 'canceled');
  expect(requests).toHaveBeenCalledTimes(count);
  // Same-second snapshots are not used for ordering or entitlement either.
  await send('evt_same_second', 300, 'customer.subscription.updated', 'active', 'canceled');
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(false);
});

test('subscription sync discards a slower concurrent response and upserts deletion first', async () => {
  const f = await fixture(false);
  const subscription = { stripeSubscriptionId: 'sub_race_audit', stripeCustomerId: 'cus_audit', status: 'canceled', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600, cancelAtPeriodEnd: false, quantity: 1, priceId: 'price_audit', metadata: { userId: ownerId } };
  const first = await f.t.mutation(internal.billing.beginSubscriptionSync, { stripeSubscriptionId: subscription.stripeSubscriptionId, eventId: 'evt_first' });
  const second = await f.t.mutation(internal.billing.beginSubscriptionSync, { stripeSubscriptionId: subscription.stripeSubscriptionId, eventId: 'evt_second' });
  expect(await f.t.mutation(internal.billing.applySubscriptionSync, { ...subscription, eventId: 'evt_second', token: second! })).toBe(true);
  expect(await f.t.mutation(internal.billing.applySubscriptionSync, { ...subscription, status: 'active', eventId: 'evt_first', token: first! })).toBe(false);
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(false);
  expect(await f.t.query(components.stripe.public.getSubscription, { stripeSubscriptionId: subscription.stripeSubscriptionId })).toMatchObject({ status: 'canceled' });
});

test('tampered webhooks cannot write; failed Stripe reads remain retryable without leaking details', async () => {
  const f = await fixture(false), stripe = new Stripe('sk_test_audit');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const requests = vi.spyOn(Stripe.StripeResource.prototype, '_makeRequest').mockRejectedValue(new Error('Private Stripe error details'));
  const payload = JSON.stringify({ id: 'evt_forged', type: 'customer.subscription.created', data: { object: { id: 'sub_forged', status: 'active' } } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
  for (const headers of [new Headers(), new Headers({ 'stripe-signature': signature })]) expect((await f.t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers })).status).toBe(400);
  expect(requests).not.toHaveBeenCalled();
  expect(await f.t.run(ctx => ctx.db.query('billingSubscriptionSync').take(1))).toEqual([]);
  const validSignature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_audit' });
  const failed = await f.t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': validSignature } });
  expect(failed.status).toBe(500); expect(await failed.text()).not.toContain('Private');
  expect(JSON.stringify(errors.mock.calls)).not.toContain('Private');
  expect((await f.t.run(ctx => ctx.db.query('billingSubscriptionSync').take(1)))[0].lastEventId).toBeUndefined();
  requests.mockResolvedValue({ id: 'sub_forged', customer: 'cus_audit', status: 'canceled', metadata: {}, items: { data: [] } } as never);
  expect((await f.t.fetch('/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': validSignature } })).status).toBe(200);
  expect((await f.t.run(ctx => ctx.db.query('billingSubscriptionSync').take(1)))[0].lastEventId).toBe('evt_forged');
});

test.each(['past_due', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'canceled'])('%s subscriptions cannot grant editing through a forged client checkout success', async status => {
  const f = await fixture(false);
  await f.t.mutation(components.stripe.private.handleSubscriptionCreated, { stripeSubscriptionId: 'sub_status_audit', stripeCustomerId: 'cus_audit', priceId: 'price_audit', status, currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600, cancelAtPeriodEnd: false, metadata: { userId: ownerId, app: 'revline-editor' } });
  expect(await f.owner.query(api.billing.isSubscribed, {})).toBe(false);
  await expect(f.owner.mutation(api.assets.saveFocus, { projectId: f.projectId, assetId: f.assetId, focus })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect((await f.other.query(api.billing.status, {})).subscribed).toBe(false);
});

test('checkout and portal accept no client customer, price or entitlement overrides', async () => {
  const f = await fixture(false);
  await expect(f.t.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('Authentication required');
  await expect(f.t.action(api.billing.createPortal, {})).rejects.toThrow('Authentication required');
  await expect(f.owner.action(api.billing.createCheckout, { plan: 'pro', priceId: 'price_attacker' } as never)).rejects.toThrow();
  await expect(f.owner.action(api.billing.createPortal, { customerId: 'cus_someone_else' } as never)).rejects.toThrow();
});

test('clip export queues a separate bounded snapshot while normal export keeps the whole saved timeline',async()=>{
  const f=await fixture();
  const timeline={fps:30,aspectRatio:'vertical' as const,clips:[
    {id:'first',kind:'video' as const,assetId:f.assetId,start:0,duration:1,sourceStart:0},
    {id:'target',kind:'video' as const,assetId:f.assetId,start:2,duration:1,sourceStart:1},
  ]};
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{timeline,revision:4}));
  const settings={projectId:f.projectId,resolution:720,fps:30,quality:'standard'};
  await expect(f.other.mutation(api.renders.start,{...settings,clipId:'target'})).rejects.toThrow();
  await expect(f.owner.mutation(api.renders.start,{...settings,clipId:'missing'})).rejects.toThrow('existing footage');
  const id=await f.owner.mutation(api.renders.start,{...settings,clipId:'target'});
  const clipJob=await f.t.run(ctx=>ctx.db.get(id));
  expect(clipJob).toMatchObject({sourceClipId:'target',sourceRevision:4,timeline:{clips:[{id:'target',start:0,duration:1,sourceStart:1}]}});
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).timeline?.clips).toEqual(timeline.clips);
  await f.owner.mutation(api.renders.cancel,{jobId:id});
  const fullId=await f.owner.mutation(api.renders.start,settings);
  const fullJob=await f.t.run(ctx=>ctx.db.get(fullId));
  expect(fullJob?.sourceClipId).toBeUndefined();expect(fullJob?.timeline?.clips).toEqual(timeline.clips);
});


test('a queued message rechecks billing before it starts and pauses without losing the request',async()=>{
  const f=await fixture();
  vi.stubEnv('OPENAI_API_KEY','fixture-only');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6.1-sol');vi.stubEnv('AI_GATEWAY_ENABLED','false');
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:true,aiRunId:'existing'}));
  await f.owner.mutation(api.assistant.send,{projectId:f.projectId,prompt:'Add captions after this edit'});
  await revoke(f,'revoked');
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{aiRunning:false}));
  await f.t.mutation(internal.assistant.drainQueue,{projectId:f.projectId,ownerId});
  const queue=await f.owner.query(api.assistant.queued,{projectId:f.projectId});
  expect(queue.paused).toBe(true);
  expect(queue.messages).toHaveLength(1);
  expect(queue.messages[0].error).toBeTruthy();
  expect((await f.owner.query(api.projects.get,{projectId:f.projectId})).aiRunning).toBe(false);
  await f.owner.mutation(api.assistant.removeQueued,{projectId:f.projectId,id:queue.messages[0].id});
});
import {mediaUrl} from './lib/media_storage';
import {verifyMediaToken} from '../lib/storage/media-tokens';
test('playback recovery refreshes the signed URL while ordinary media URLs stay cacheable',async()=>{
  vi.stubEnv('MEDIA_WORKER_URL','https://media.example.com');vi.stubEnv('MEDIA_SIGNING_SECRET','audit-signing-secret');
  const time=vi.spyOn(Date,'now').mockReturnValue(1_800_000_000_000);
  try{
    const source={r2Key:'media/owner/project/source'},ctx={} as Parameters<typeof mediaUrl>[0];
    const stable=await mediaUrl(ctx,source),fresh=await mediaUrl(ctx,source,true);
    expect(await mediaUrl(ctx,source)).toBe(stable);
    expect(fresh).not.toBe(stable);
    expect(await verifyMediaToken('audit-signing-secret',new URL(fresh!).searchParams.get('token')!)).toMatchObject({operation:'read',key:source.r2Key});
    time.mockReturnValue(1_800_000_000_001);expect(await mediaUrl(ctx,source,true)).not.toBe(fresh);
  }finally{time.mockRestore();}
});

async function previewFixture() {
  const f=await fixture(),leaseToken='owned-preview-lease';
  await f.t.run(async ctx=>{
    await ctx.db.patch(f.assetId,{r2Key:`media/${ownerId}/${f.projectId}/original`,width:1080,height:1920});
    const {recordAssetStorage}=await import('./lib/storage_accounting');await recordAssetStorage(ctx,(await ctx.db.get(f.assetId))!);
    await ctx.db.patch(f.taskId,{kind:'preview',previewVersion:1,status:'running',leaseToken,leaseExpiresAt:Date.now()+60_000,requiredProcessorVersion:5});
  });
  const metadata={projectId:f.projectId,taskId:f.taskId,leaseToken,purpose:'preview' as const,sourceAssetId:f.assetId,previewFps:60,previewVersion:1,kind:'video' as const,contentType:'video/mp4',fileName:'Private.preview.mp4',size:10,duration:3,width:608,height:1080};
  return {...f,leaseToken,metadata};
}
async function savePreview(f:Awaited<ReturnType<typeof previewFixture>>) {
  const lease=await f.t.action(api.r2.start,f.metadata);
  const parent=await f.t.action(api.r2.complete,{uploadId:lease.uploadId,taskId:f.taskId,leaseToken:f.leaseToken,parts:[{partNumber:1,etag:'preview-etag'}]});
  return {...lease,parent};
}
test('preview tasks require project ownership, deduplicate and cannot be claimed by older processors',async()=>{
  const f=await fixture();
  expect(await f.t.query(api.mediaTasks.processorContract,{workerSecret:'audit-worker-secret'})).toEqual({processorVersion:5});
  await expect(f.other.mutation(api.mediaTasks.start,{projectId:f.projectId,assetId:f.assetId,kind:'preview'})).rejects.toThrow();
  const taskId=await f.owner.mutation(api.mediaTasks.start,{projectId:f.projectId,assetId:f.assetId,kind:'preview'});
  expect(await f.owner.mutation(api.mediaTasks.start,{projectId:f.projectId,assetId:f.assetId,kind:'preview'})).toBe(taskId);
  await f.t.run(ctx=>ctx.db.patch(taskId,{claimable:true}));
  expect(await f.t.mutation(api.mediaTasks.claim,{workerSecret:'audit-worker-secret',processorVersion:4,compact:true})).toBeNull();
  const task=await f.t.mutation(api.mediaTasks.claim,{workerSecret:'audit-worker-secret',processorVersion:5,compact:true});
  expect(task).toMatchObject({taskId,kind:'preview'});
});
test('preview multipart credentials restrict purpose, source, output type and lease attempt',async()=>{
  const f=await previewFixture();
  await expect(f.owner.action(api.r2.start,{...f.metadata,taskId:undefined,leaseToken:undefined})).rejects.toThrow('cannot upload');
  await expect(f.t.action(api.r2.start,{...f.metadata,purpose:undefined})).rejects.toThrow('purpose');
  await expect(f.t.action(api.r2.start,{...f.metadata,kind:'audio',contentType:'audio/mp4'})).rejects.toThrow('cannot upload');
  await expect(f.t.action(api.r2.start,{...f.metadata,previewVersion:2})).rejects.toThrow('cannot upload');
  const another=await f.t.run(ctx=>ctx.db.insert('assets',{ownerId,projectId:f.projectId,fileName:'Other.mp4',contentType:'video/mp4',kind:'video',size:10,createdAt:0}));
  await expect(f.t.action(api.r2.start,{...f.metadata,sourceAssetId:another})).rejects.toThrow('cannot upload');
  const {uploadId}=await f.t.action(api.r2.start,f.metadata);
  await expect(f.t.action(api.r2.partUrl,{uploadId,taskId:f.taskId,leaseToken:'wrong-attempt',partNumber:1})).rejects.toThrow('lease');
  await f.t.run(ctx=>ctx.db.patch(f.taskId,{leaseToken:'new-attempt'}));
  await expect(f.t.action(api.r2.partUrl,{uploadId,taskId:f.taskId,leaseToken:'new-attempt',partNumber:1})).rejects.toThrow('another task attempt');
});
test('private preview completion preserves originals, adds auxiliary bytes and never creates another source or audio output',async()=>{
  const f=await previewFixture();
  await expect(f.t.mutation(api.mediaTasks.complete,{taskId:f.taskId,leaseToken:f.leaseToken,result:{}})).rejects.toThrow('not been stored');
  const {parent}=await savePreview(f);expect(parent).toBe(f.assetId);
  const asset=await f.owner.query(api.assets.get,{projectId:f.projectId,assetId:f.assetId});
  expect(asset.r2Key).toBe(`media/${ownerId}/${f.projectId}/original`);
  expect(asset.previewR2Key).not.toBe(asset.r2Key);expect(asset.previewVersion).toBe(1);
  expect(await verifyMediaToken('audit-signing-secret',new URL(asset.url!).searchParams.get('token')!)).toMatchObject({operation:'read',key:asset.r2Key});
  expect(await verifyMediaToken('audit-signing-secret',new URL(asset.previewUrl!).searchParams.get('token')!)).toMatchObject({operation:'read',key:asset.previewR2Key});
  expect(await f.owner.query(api.assets.list,{projectId:f.projectId})).toHaveLength(1);
  const storage=await f.owner.query(api.storage.summary,{});expect(storage).toMatchObject({usedBytes:20,reservedBytes:0,fileCount:1});
  const rows=await f.t.run(ctx=>ctx.db.query('storageObjects').withIndex('by_owner_key',q=>q.eq('ownerId',ownerId)).take(10));
  const derivative=rows.find(row=>row.r2Key===asset.previewR2Key)!;expect(derivative.auxiliary).toBe(true);
  await expect(f.owner.mutation(api.storage.remove,{fileIds:[derivative._id]})).rejects.toThrow('File not found');
  expect((await f.t.run(ctx=>ctx.db.get(f.taskId)))?.outputAssetId).toBeUndefined();
  await f.t.mutation(api.mediaTasks.complete,{taskId:f.taskId,leaseToken:f.leaseToken,result:{}});
  const refresh=await f.owner.action(api.playback.refresh,{projectId:f.projectId,assetIds:[f.assetId]});
  expect(await verifyMediaToken('audit-signing-secret',new URL(refresh[0].url!).searchParams.get('token')!)).toMatchObject({key:asset.previewR2Key});
  await expect(f.other.action(api.playback.refresh,{projectId:f.projectId,assetIds:[f.assetId]})).rejects.toThrow();
});
test('finishing an older source preview preserves the current project cover',async()=>{
  const f=await previewFixture(),coverStorageId=await f.t.run(ctx=>ctx.storage.store(new Blob(['new cover'],{type:'image/png'})));
  await f.t.run(async ctx=>{
    const {recordAssetStorage}=await import('./lib/storage_accounting');
    const newerId=await ctx.db.insert('assets',{ownerId,projectId:f.projectId,storageId:coverStorageId,fileName:'Newer.png',kind:'image',contentType:'image/png',size:9,createdAt:1});
    await recordAssetStorage(ctx,(await ctx.db.get(newerId))!);
  });
  const cover=()=>f.t.run(ctx=>ctx.db.query('projectCatalog').withIndex('by_project',q=>q.eq('projectId',f.projectId)).unique());
  expect(await cover()).toMatchObject({coverKind:'image',coverStorageId});
  await savePreview(f);
  expect(await cover()).toMatchObject({coverKind:'image',coverStorageId});
});

test.each(['queued','rendering','cancelled'] as const)('storage permits removal of %s exports only after they stop',async status=>{
  const f=await fixture(),key=`media/${ownerId}/${f.projectId}/export`;
  await f.t.run(async ctx=>{
    const {recordStorageObject}=await import('./lib/storage_accounting');
    await ctx.db.patch(f.jobId,{status,outputR2Key:key});
    await recordStorageObject(ctx,{ownerId,r2Key:key,fileName:'Export.mp4',kind:'export',size:10,createdAt:0,jobId:f.jobId});
  });
  const result=await f.owner.query(api.storage.files,{paginationOpts:{numItems:10,cursor:null},sort:'largest'}),row=result.page[0];
  expect(row).toMatchObject({canDelete:status==='cancelled',protectedReason:status==='cancelled'?null:'Export in progress'});
  if(status==='cancelled'){
    await f.owner.mutation(api.storage.remove,{fileIds:[row.id]});
    expect(await f.t.run(ctx=>ctx.db.get(f.jobId))).toBeNull();
    expect((await f.owner.query(api.storage.summary,{})).usedBytes).toBe(0);
  }else{
    await expect(f.owner.mutation(api.storage.remove,{fileIds:[row.id]})).rejects.toThrow('Export in progress');
    expect(await f.t.run(ctx=>ctx.db.get(f.jobId))).not.toBeNull();
  }
});
test('export snapshots keep the original URL even when a private preview exists',async()=>{
  const f=await previewFixture();await savePreview(f);
  const timeline={aspectRatio:'vertical' as const,fps:30 as const,clips:[{id:'video',assetId:f.assetId,kind:'video' as const,start:0,duration:3,sourceStart:0}]};
  await f.t.run(async ctx=>{await ctx.db.patch(f.jobId,{timeline,assetIds:[f.assetId],status:'rendering'});await ctx.db.patch(f.taskId,{kind:'render',renderJobId:f.jobId});});
  const work=await f.t.query(api.mediaTasks.work,{taskId:f.taskId,leaseToken:f.leaseToken});
  const original=await f.t.run(ctx=>ctx.db.get(f.assetId));
  expect(await verifyMediaToken('audit-signing-secret',new URL(work.render!.assets[0].url!).searchParams.get('token')!)).toMatchObject({key:original!.r2Key});
});
test('shared copies pin previews until the final attachment is removed and reclaim their bytes separately',async()=>{
  const f=await previewFixture();await savePreview(f);
  const timeline={aspectRatio:'vertical' as const,fps:30 as const,clips:[{id:'video',assetId:f.assetId,kind:'video' as const,start:0,duration:3,sourceStart:0}]};
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{timeline}));
  const original=await f.t.run(ctx=>ctx.db.get(f.assetId)),shareId=await f.owner.mutation(api.timelineShares.publish,{projectId:f.projectId});
  const shared=(await f.t.query(api.timelineShares.get,{shareId}))!.assets[0];
  expect(shared.previewUrl).toBeTruthy();expect(shared).toMatchObject({previewSize:10,previewVersion:1,previewWidth:608,previewHeight:1080,previewFps:60});expect(shared).not.toHaveProperty('previewR2Key');expect(shared).not.toHaveProperty('r2Key');expect(shared).not.toHaveProperty('ownerId');
  const copiedId=await f.owner.mutation(api.timelineShares.useTimeline,{shareId});
  const copies=await f.owner.query(api.assets.list,{projectId:copiedId});expect(copies[0].previewR2Key).toBe(original!.previewR2Key);
  await f.t.run(ctx=>writeProject(ctx,f.projectId,{timeline:{...timeline,clips:[]}}));
  await f.owner.mutation(api.assets.remove,{assetId:f.assetId});
  await f.owner.mutation(api.timelineShares.revoke,{projectId:f.projectId});
  expect((await f.owner.query(api.storage.summary,{})).usedBytes).toBe(20);
  await f.t.run(ctx=>writeProject(ctx,copiedId,{timeline:{...timeline,clips:[]}}));
  await f.owner.mutation(api.assets.remove,{assetId:copies[0]._id});
  expect((await f.owner.query(api.storage.summary,{})).usedBytes).toBe(0);
  const scheduled=await f.t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
  const deletes=scheduled.filter(row=>row.name==='r2:deleteObject').map(row=>(row.args[0] as {key:string}).key);
  expect(deletes).toContain(original!.r2Key);expect(deletes).toContain(original!.previewR2Key);
});

test('batch playback preparation stays within the authenticated project and skips a completed derivative',async()=>{
  const f=await previewFixture();
  await expect(f.other.mutation(api.playback.prepare,{projectId:f.projectId,assetIds:[f.assetId]})).rejects.toThrow();
  expect(await f.owner.mutation(api.playback.prepare,{projectId:f.projectId,assetIds:[f.assetId,f.assetId]})).toEqual([f.taskId]);
  expect(await f.owner.mutation(api.playback.prepare,{projectId:f.projectId,assetIds:[f.assetId]})).toEqual([f.taskId]);
  await savePreview(f);
  expect(await f.owner.mutation(api.playback.prepare,{projectId:f.projectId,assetIds:[f.assetId]})).toEqual([]);
});
test('duplicate preview uploads keep one derivative and release the unused reservation',async()=>{
  const f=await previewFixture(),first=await savePreview(f),before=await f.t.run(ctx=>ctx.db.get(f.assetId));
  const second=await savePreview(f);expect(second.uploadId).not.toBe(first.uploadId);
  const after=await f.t.run(ctx=>ctx.db.get(f.assetId));expect(after!.previewR2Key).toBe(before!.previewR2Key);
  expect(await f.owner.query(api.storage.summary,{})).toMatchObject({usedBytes:20,reservedBytes:0,fileCount:1});
});
test('preview upload failure from quota or removed source leaves the original untouched',async()=>{
  const f=await previewFixture();
  await expect(f.t.action(api.r2.start,{...f.metadata,duration:4})).rejects.toThrow('duration must match');
  await f.t.run(async ctx=>{const {recordAssetStorage}=await import('./lib/storage_accounting');await recordAssetStorage(ctx,(await ctx.db.get(f.assetId))!);await ctx.db.insert('storageAccounting',{name:'objects-v1',ready:true});});
  vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','15');
  await expect(f.t.action(api.r2.start,f.metadata)).rejects.toThrow('cloud storage is full');
  expect(await f.owner.query(api.storage.summary,{})).toMatchObject({usedBytes:10,reservedBytes:0,fileCount:1});
  expect((await f.t.run(ctx=>ctx.db.get(f.assetId)))?.previewR2Key).toBeUndefined();
  vi.stubEnv('ACCOUNT_STORAGE_LIMIT_BYTES','15000000000');
  const {uploadId}=await f.t.action(api.r2.start,f.metadata);
  await f.t.run(ctx=>ctx.db.delete(f.assetId));
  await expect(f.t.action(api.r2.complete,{uploadId,taskId:f.taskId,leaseToken:f.leaseToken,parts:[{partNumber:1,etag:'preview-etag'}]})).rejects.toThrow('source is unavailable');
});

test('project transfer rejects a preview key outside the explicitly copied target namespace',async()=>{
  const f=await fixture(),email='preview-audit@example.com',transferId='11111111-1111-4111-8111-111111111111';
  await f.t.run(ctx=>ctx.db.insert('users',{clerkId:ownerId,email,createdAt:0,updatedAt:0}));
  const args={transferKey:'preview-transfer',transferId,sourceDeployment:'development',sourceProjectId:String(f.projectId),sourceRevision:0,fingerprint:'a'.repeat(64),ownerId,email,title:'Transferred preview',aspectRatio:'vertical' as const,timeline:{fps:30 as const,aspectRatio:'vertical' as const,clips:[{id:'video',assetId:String(f.assetId),kind:'video' as const,start:0,duration:3,sourceStart:0}]},history:[],conversation:[],publicChat:[],media:[{sourceId:String(f.assetId),r2Key:`media/${ownerId}/${transferId}/22222222-2222-4222-8222-222222222222`,fileName:'Original.mp4',contentType:'video/mp4',size:10,kind:'video' as const,duration:3,width:1080,height:1920,previewR2Key:'media/another-owner/project/private-preview',previewSize:5,previewWidth:608,previewHeight:1080,previewFps:60,previewVersion:1}]};
  await expect(f.t.mutation(internal.projectTransfers.importSnapshot,args)).rejects.toThrow('target namespace');
  expect(await f.t.run(ctx=>ctx.db.query('projectTransferReceipts').withIndex('by_key',q=>q.eq('transferKey','preview-transfer')).first())).toBeNull();
});


test.each(['cancelled','expired'] as const)('scheduled preview upload cleanup works after its task is %s',async mode=>{
  const f=await previewFixture(),{uploadId}=await f.t.action(api.r2.start,f.metadata);
  const lease=(await f.t.run(ctx=>ctx.db.get(uploadId)))!;
  await f.t.run(ctx=>ctx.db.patch(f.taskId,mode==='cancelled'?{status:'cancelled'}:{leaseExpiresAt:Date.now()-1}));
  await expect(f.t.action(api.r2.abort,{uploadId,taskId:f.taskId,leaseToken:f.leaseToken})).rejects.toThrow('lease');
  await f.t.action(internal.r2.cleanupLease,{uploadId});
  expect(await f.t.run(ctx=>ctx.db.get(uploadId))).toBeNull();
  expect((await f.owner.query(api.storage.summary,{})).reservedBytes).toBe(0);
  expect((await f.t.run(ctx=>ctx.db.get(f.assetId)))!.r2Key).toBe(`media/${ownerId}/${f.projectId}/original`);
  const controls=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String(init?.body)));
  expect(controls).toContainEqual({action:'abort',key:lease.key,uploadId:lease.uploadId});
  expect(controls).toContainEqual({action:'delete',key:lease.key});
  expect(controls.some(body=>body.action==='delete'&&body.key===`media/${ownerId}/${f.projectId}/original`)).toBe(false);
});
