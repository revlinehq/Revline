/// <reference types="vite/client" />
import { StripeSubscriptions } from '@convex-dev/stripe';
import stripeTest from '@convex-dev/stripe/test';
import workflowTest from '@convex-dev/workflow/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import schema from './schema';
import * as editorAccessAdmin from './editorAccess';

const modules = import.meta.glob('./**/*.ts');
const stripeMock = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), price: vi.fn(), subscriptions: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  checkout = { sessions: { create: stripeMock.create, retrieve: stripeMock.retrieve } };
  prices = { retrieve: stripeMock.price };
  subscriptions = { list: stripeMock.subscriptions };
} }));
const identity = { subject: 'owner', issuer: 'https://test.clerk.accounts.dev', tokenIdentifier: 'https://test.clerk.accounts.dev|owner' };
function fixture() {
  const t = convexTest(schema, modules);
  stripeTest.register(t);
  return { t, owner: t.withIdentity(identity) };
}
beforeEach(() => {
  vi.stubEnv('BILLING_ENABLED', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fixture');
  vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_editor');
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3001');
  vi.spyOn(StripeSubscriptions.prototype, 'getOrCreateCustomer').mockResolvedValue({ customerId: 'cus_owner', isNew: false });
  stripeMock.create.mockReset().mockResolvedValue({ id: 'cs_fixture', url: 'https://checkout.stripe.com/fixture', expires_at: Math.floor(Date.now() / 1000) + 86400 });
  stripeMock.retrieve.mockReset().mockResolvedValue({ id: 'cs_fixture', status: 'open', url: 'https://checkout.stripe.com/fixture' });
  stripeMock.price.mockReset().mockResolvedValue({ active: true, currency: 'usd', unit_amount: 3900, recurring: { interval: 'month', interval_count: 1 } });
  stripeMock.subscriptions.mockReset().mockResolvedValue({ data: [], has_more: false });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function subscription(t: ReturnType<typeof fixture>['t'], status: string, userId = 'owner', priceId = 'price_editor') {
  await t.mutation(components.stripe.private.handleSubscriptionCreated, {
    stripeSubscriptionId: `sub_${userId}_${status}`, stripeCustomerId: `cus_${userId}`, status,
    currentPeriodEnd: 2000000000, cancelAtPeriodEnd: false, priceId,
    metadata: { userId, ...(priceId === 'price_editor' ? { app: 'revline-editor' } : {}) },
  });
}
test('first editor subscription receives three days free and requires a payment method', async () => {
  const { owner } = fixture();
  await owner.action(api.billing.createCheckout, { plan: 'pro' });
  expect(stripeMock.create).toHaveBeenCalledWith(expect.objectContaining({
    line_items: [{ price: 'price_editor', quantity: 1 }], mode: 'subscription', customer: 'cus_owner',
    payment_method_collection: 'always',
    managed_payments: { enabled: false },
    subscription_data: { metadata: { userId: 'owner', app: 'revline-editor' }, trial_period_days: 3, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } },
  }), { idempotencyKey: expect.stringMatching(/^revline-checkout-/) });
});
test('a canceled subscription cannot start another free trial', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'canceled');
  expect(await owner.query(api.billing.status, {})).toMatchObject({ subscribed: false, trialEligible: false });
  await owner.action(api.billing.createCheckout, { plan: 'pro' });
  expect(stripeMock.create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days');
});
test.each(['active', 'trialing'])('an existing %s subscription cannot create another checkout', async status => {
  const { t, owner } = fixture();
  await subscription(t, status);
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('already have a subscription');
  expect(stripeMock.create).not.toHaveBeenCalled();
  expect(await owner.query(api.billing.isSubscribed, {})).toBe(true);
});
test('subscriptions belonging to other users or products do not grant editor access or use the trial', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'active', 'stranger');
  await subscription(t, 'active', 'owner', 'price_unrelated');
  expect(await owner.query(api.billing.status, {})).toMatchObject({ subscribed: false, trialEligible: true });
});
test('signed-out checkout is refused before creating a Stripe customer', async () => {
  const { t } = fixture();
  await expect(t.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('Authentication required');
  expect(StripeSubscriptions.prototype.getOrCreateCustomer).not.toHaveBeenCalled();
});

test('reopening checkout reuses the open session and does not create another subscription flow', async () => {
  const { owner } = fixture();
  const first = await owner.action(api.billing.createCheckout, { plan: 'pro' });
  expect(await owner.action(api.billing.createCheckout, { plan: 'pro' })).toEqual(first);
  expect(stripeMock.create).toHaveBeenCalledTimes(1);
});
test('concurrent reservations share a server-generated idempotency key', async () => {
  const { t } = fixture();
  const args = { ownerId: 'owner', priceId: 'price_editor', origin: 'http://localhost:3001', trialEligible: true };
  const [a, b] = await Promise.all([t.mutation(internal.billing.reserveCheckout, args), t.mutation(internal.billing.reserveCheckout, args)]);
  expect(a.requestId).toBe(b.requestId);
});
test('misconfigured prices are rejected before checkout', async () => {
  const { owner } = fixture();
  stripeMock.price.mockResolvedValue({ active: true, currency: 'usd', unit_amount: 9900, recurring: { interval: 'month', interval_count: 1 } });
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('does not match');
  expect(stripeMock.create).not.toHaveBeenCalled();
});
test('a Stripe subscription missing from delayed webhooks still prevents a duplicate checkout', async () => {
  const { owner } = fixture();
  stripeMock.subscriptions.mockResolvedValue({ data: [{ status: 'trialing', items: { data: [{ price: { id: 'price_editor' } }] }, metadata: { app: 'revline-editor' } }], has_more: false });
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('already have');
  expect(stripeMock.create).not.toHaveBeenCalled();
});

test('unsubscribed users cannot bypass the upload, edit, AI, analysis, or export guard', async () => {
  const { t, owner } = fixture();
  const projectId = await t.run(ctx => ctx.db.insert('projects', { ownerId: 'owner', title: 'Existing edit', aspectRatio: 'vertical', createdAt: 1, updatedAt: 1, revision: 0 }));
  const assetId = await t.run(ctx => ctx.db.insert('assets', { ownerId: 'owner', projectId, fileName: 'source.mp4', kind: 'video', contentType: 'video/mp4', size: 10, createdAt: 1 }));
  const calls = [
    owner.mutation(api.projects.create, { title: 'New', aspectRatio: 'vertical' }),
    owner.mutation(api.projects.saveTimeline, { projectId, timeline: { clips: [], fps: 30, aspectRatio: 'vertical' }, expectedRevision: 0 }),
    owner.mutation(api.projects.update, { projectId, aspectRatio: 'square' }),
    owner.mutation(api.projects.undo, { projectId }),
    owner.mutation(api.assets.generateUploadUrl, { projectId }),
    owner.action(api.r2.start, { projectId, fileName: 'source.mp4', kind: 'video', contentType: 'video/mp4', size: 10 }),
    owner.mutation(api.assistant.send, { projectId, prompt: 'Edit this' }),
    owner.mutation(api.mediaTasks.start, { projectId, assetId, kind: 'understand' }),
    owner.mutation(api.renders.start, { projectId, resolution: 1080, fps: 30, quality: 'high' }),
  ];
  for (const result of await Promise.allSettled(calls)) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(String(result.reason)).toContain('SUBSCRIPTION_REQUIRED');
  }
  expect((await owner.query(api.projects.get, { projectId })).title).toBe('Existing edit');
});
test('trial access follows subscription updates and cancellation revokes writes', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'trialing');
  const projectId = await owner.mutation(api.projects.create, { title: 'My trial edit', aspectRatio: 'vertical' });
  const update = async (status: string, cancelAtPeriodEnd = false) => t.mutation(components.stripe.private.handleSubscriptionUpdated, { stripeSubscriptionId: 'sub_owner_trialing', status, currentPeriodEnd: 2000000000, cancelAtPeriodEnd });
  await update('active', true);
  await owner.mutation(api.projects.update, { projectId, title: 'Paid edit' });
  await update('past_due');
  expect(await owner.query(api.billing.status, {})).toMatchObject({ subscribed: false, needsPayment: true });
  await expect(owner.mutation(api.projects.update, { projectId, title: 'Blocked' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('existing subscription');
  await t.mutation(components.stripe.private.handleSubscriptionDeleted, { stripeSubscriptionId: 'sub_owner_trialing' });
  expect(await owner.query(api.billing.status, {})).toMatchObject({ subscribed: false, trialEligible: false });
  await expect(owner.mutation(api.projects.update, { projectId, title: 'Still blocked' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});
test('billing enabled with missing credentials fails closed', async () => {
  const { owner } = fixture();
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  await expect(owner.mutation(api.projects.create, { title: 'No bypass', aspectRatio: 'vertical' })).rejects.toThrow('BILLING_UNAVAILABLE');
});
test('another user’s subscription does not authorize project creation', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'active', 'stranger');
  await expect(owner.mutation(api.projects.create, { title: 'No bypass', aspectRatio: 'vertical' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});
test('an expired trial cannot retain access while a webhook is delayed', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'trialing');
  await t.mutation(components.stripe.private.handleSubscriptionUpdated, { stripeSubscriptionId: 'sub_owner_trialing', status: 'trialing', currentPeriodEnd: Math.floor(Date.now() / 1000) - 1, cancelAtPeriodEnd: false });
  expect(await owner.query(api.billing.isSubscribed, {})).toBe(false);
  await expect(owner.mutation(api.projects.create, { title: 'Expired', aspectRatio: 'vertical' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});

const complimentaryIdentity = { ...identity, subject: 'user_complimentary', tokenIdentifier: `${identity.issuer}|user_complimentary` };
async function complimentaryFixture(expiresAt?: number) {
  const { t } = fixture();
  await t.mutation(internal.editorAccess.grantComplimentary, { ownerId: complimentaryIdentity.subject, reason: 'Operator-approved complimentary membership', ...(expiresAt !== undefined ? { expiresAt } : {}) });
  return { t, owner: t.withIdentity(complimentaryIdentity) };
}

test('complimentary administration is internal and refuses emails as authority', async () => {
  expect(editorAccessAdmin.grantComplimentary.isInternal).toBe(true);
  expect(editorAccessAdmin.revokeComplimentary.isInternal).toBe(true);
  expect(editorAccessAdmin.complimentaryStatus.isInternal).toBe(true);
  const { t } = fixture();
  await expect(t.mutation(internal.editorAccess.grantComplimentary, { ownerId: 'person@example.com', reason: 'Invalid' })).rejects.toThrow('Clerk user ID');
  await expect(t.mutation(internal.editorAccess.grantComplimentary, { ownerId: 'user_fixture', reason: ' ' })).rejects.toThrow('reason');
});

test('lifetime complimentary access authorizes editing and export without pretending to be a Stripe subscription', async () => {
  const { t, owner } = await complimentaryFixture();
  workflowTest.register(t);
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  expect(await owner.query(api.billing.status, {})).toMatchObject({ complimentary: true, subscribed: false, trialEligible: false, needsPayment: false, plan: 'pro', configured: false });
  expect(await owner.query(api.billing.isSubscribed, {})).toBe(false);
  const projectId = await owner.mutation(api.projects.create, { title: 'Complimentary edit', aspectRatio: 'vertical' });
  await owner.mutation(api.projects.saveTimeline, { projectId, timeline: { clips: [{ id: 'title', kind: 'caption', text: 'Hello', start: 0, duration: 2, sourceStart: 0 }], fps: 30, aspectRatio: 'vertical' }, expectedRevision: 0 });
  const jobId = await owner.mutation(api.renders.start, { projectId, resolution: 1080, fps: 30, quality: 'high' });
  expect(await t.run(ctx => ctx.db.get(jobId))).toMatchObject({ ownerId: complimentaryIdentity.subject, status: 'queued' });
  expect(await t.query(internal.editorAccess.complimentaryStatus, { ownerId: complimentaryIdentity.subject })).toMatchObject({ active: true });
  expect(await t.query(internal.editorAccess.complimentaryStatus, { ownerId: complimentaryIdentity.subject })).not.toHaveProperty('expiresAt');
});

test('complimentary access cannot create Stripe checkout or portal sessions', async () => {
  const { owner } = await complimentaryFixture();
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('No payment is required');
  await expect(owner.action(api.billing.createPortal, {})).rejects.toThrow('does not require a billing portal');
  expect(StripeSubscriptions.prototype.getOrCreateCustomer).not.toHaveBeenCalled();
  expect(stripeMock.create).not.toHaveBeenCalled();
});

test('complimentary entitlement belongs only to its Clerk subject and does not weaken project ownership', async () => {
  const { t, owner } = await complimentaryFixture();
  const projectId = await owner.mutation(api.projects.create, { title: 'Private', aspectRatio: 'vertical' });
  const stranger = t.withIdentity({ ...identity, subject: 'user_stranger', tokenIdentifier: `${identity.issuer}|user_stranger`, email: 'same-address@example.com' });
  expect(await stranger.query(api.billing.status, {})).not.toHaveProperty('complimentary');
  expect(await t.query(api.billing.status, {})).not.toHaveProperty('complimentary');
  await expect(t.mutation(api.projects.create, { title: 'Anonymous', aspectRatio: 'vertical' })).rejects.toThrow('Authentication required');
  await expect(stranger.mutation(api.projects.create, { title: 'Blocked', aspectRatio: 'vertical' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  await t.mutation(internal.editorAccess.grantComplimentary, { ownerId: 'user_stranger', reason: 'Independent grant' });
  await expect(stranger.mutation(api.projects.update, { projectId, title: 'Stolen' })).rejects.toThrow('Project not found');
});

test('expiration and revocation remove complimentary write access', async () => {
  const { t, owner } = await complimentaryFixture(Date.now() + 3600000);
  const entitlement = await t.run(ctx => ctx.db.query('editorEntitlements').withIndex('by_owner', q => q.eq('ownerId', complimentaryIdentity.subject)).unique());
  await t.run(ctx => ctx.db.patch(entitlement!._id, { expiresAt: Date.now() - 1 }));
  expect(await owner.query(api.billing.status, {})).not.toHaveProperty('complimentary');
  await expect(owner.mutation(api.projects.create, { title: 'Expired', aspectRatio: 'vertical' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
  const id = await t.mutation(internal.editorAccess.grantComplimentary, { ownerId: complimentaryIdentity.subject, reason: 'Lifetime renewal' });
  expect(id).toBe(entitlement!._id);
  expect(await t.query(internal.editorAccess.complimentaryStatus, { ownerId: complimentaryIdentity.subject })).not.toHaveProperty('expiresAt');
  await t.mutation(internal.editorAccess.revokeComplimentary, { ownerId: complimentaryIdentity.subject });
  expect(await t.query(internal.editorAccess.hasComplimentary, { ownerId: complimentaryIdentity.subject })).toBe(false);
  await expect(owner.mutation(api.projects.create, { title: 'Revoked', aspectRatio: 'vertical' })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
});
