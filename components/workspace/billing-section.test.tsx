import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingSection } from './billing-section';

const connection = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
const membership = vi.hoisted(() => ({ status: undefined as undefined | { enabled: boolean; configured: boolean; subscribed: boolean; complimentary?: boolean; complimentaryExpiresAt?: number; trialEligible: boolean; needsPayment: boolean } }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => connection,
  useQuery: () => membership.status,
  useAction: () => vi.fn(),
}));

describe('membership connection states', () => {
  beforeEach(() => { Object.assign(connection, { isAuthenticated: false, isLoading: false }); membership.status = undefined; });

  it('offers sign-in when the membership query is skipped', () => {
    const html = renderToStaticMarkup(<BillingSection />);
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain('Loading your plan');
  });

  it('keeps the loading state while authentication is connecting', () => {
    connection.isLoading = true;
    expect(renderToStaticMarkup(<BillingSection />)).toContain('Loading your plan');
  });

  it('shows lifetime complimentary access without offering a checkout or billing portal', () => {
    connection.isAuthenticated = true;
    membership.status = { enabled: true, configured: true, subscribed: false, complimentary: true, trialEligible: false, needsPayment: false };
    const html = renderToStaticMarkup(<BillingSection />);
    expect(html).toContain('Free access forever');
    expect(html).toContain('href="/dashboard/chat"');
    expect(html).not.toContain('Manage subscription');
    expect(html).not.toContain('Subscribe');
    expect(html).not.toContain('$39');
    expect(html).not.toContain('A payment method is required');
  });

  it('shows an expiration for temporary complimentary access', () => {
    connection.isAuthenticated = true;
    membership.status = { enabled: true, configured: true, subscribed: false, complimentary: true, complimentaryExpiresAt: Date.now() + 86400000, trialEligible: false, needsPayment: false };
    const html = renderToStaticMarkup(<BillingSection />);
    expect(html).toContain('Free access until');
    expect(html).not.toContain('Free access forever');
  });
});
