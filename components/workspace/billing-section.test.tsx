import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingSection } from './billing-section';

const connection = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
vi.mock('convex/react', () => ({
  useConvexAuth: () => connection,
  useQuery: () => undefined,
  useAction: () => vi.fn(),
}));

describe('membership connection states', () => {
  beforeEach(() => Object.assign(connection, { isAuthenticated: false, isLoading: false }));

  it('offers sign-in when the membership query is skipped', () => {
    const html = renderToStaticMarkup(<BillingSection />);
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain('Loading your plan');
  });

  it('keeps the loading state while authentication is connecting', () => {
    connection.isLoading = true;
    expect(renderToStaticMarkup(<BillingSection />)).toContain('Loading your plan');
  });
});
