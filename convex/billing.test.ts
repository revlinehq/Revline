/// <reference types="vite/client" />
import { StripeSubscriptions } from '@convex-dev/stripe';
import stripeTest from '@convex-dev/stripe/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
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
  vi.spyOn(StripeSubscriptions.prototype, 'createCheckoutSession').mockResolvedValue({ sessionId: 'cs_fixture', url: 'https://checkout.stripe.com/fixture' });
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
  expect(StripeSubscriptions.prototype.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    priceId: 'price_editor', mode: 'subscription', customerId: 'cus_owner',
    subscriptionMetadata: { userId: 'owner', app: 'revline-editor' },
    params: { payment_method_collection: 'always', subscription_data: { trial_period_days: 3, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } },
  }));
});
test('a canceled subscription cannot start another free trial', async () => {
  const { t, owner } = fixture();
  await subscription(t, 'canceled');
  expect(await owner.query(api.billing.status, {})).toMatchObject({ subscribed: false, trialEligible: false });
  await owner.action(api.billing.createCheckout, { plan: 'pro' });
  const options = vi.mocked(StripeSubscriptions.prototype.createCheckoutSession).mock.calls[0][1];
  expect(options.params?.subscription_data).not.toHaveProperty('trial_period_days');
});
test.each(['active', 'trialing'])('an existing %s subscription cannot create another checkout', async status => {
  const { t, owner } = fixture();
  await subscription(t, status);
  await expect(owner.action(api.billing.createCheckout, { plan: 'pro' })).rejects.toThrow('already have a subscription');
  expect(StripeSubscriptions.prototype.createCheckoutSession).not.toHaveBeenCalled();
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
