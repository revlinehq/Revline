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
  vi.mocked(fetch).mockImplementation(async () => {
    await f.t.mutation(internal.editorAccess.revokeComplimentary, { ownerId });
    return new Response(JSON.stringify({ size: 10, contentType: 'video/mp4' }));
  });
  await expect(f.owner.action(api.r2.complete, { uploadId, parts: [{ partNumber: 1, etag: 'fixture-etag' }] })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  expect((await f.t.run(ctx => ctx.db.get(uploadId)))?.completed).toBe(false);
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
