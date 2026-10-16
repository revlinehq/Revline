import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationPage from './page';
import DemoConversationPage from '@/app/chat/demo/page';
import LegacyChatPage from '../page';
import LegacyDashboardChatPage from '../../dashboard/chat/page';
import BillingPage from '../../billing/page';

const routing = vi.hoisted(() => ({
  protect: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`Redirect: ${destination}`); }),
}));

vi.mock('@clerk/nextjs/server', () => ({ auth: { protect: routing.protect } }));
vi.mock('next/navigation', () => ({ redirect: routing.redirect }));

describe('legacy conversation routes', () => {
  beforeEach(() => {
    routing.protect.mockReset().mockResolvedValue(undefined);
    routing.redirect.mockClear();
  });

  it('opens the same saved project in the full editor after authentication', async () => {
    await expect(ConversationPage({ params: Promise.resolve({ projectId: 'saved-project' }) }))
      .rejects.toThrow('Redirect: /editor/saved-project');
    expect(routing.protect).toHaveBeenCalledOnce();
    expect(routing.protect.mock.invocationCallOrder[0]).toBeLessThan(routing.redirect.mock.invocationCallOrder[0]);
  });

  it('keeps unauthenticated project navigation protected', async () => {
    routing.protect.mockRejectedValue(new Error('Sign in required'));
    await expect(ConversationPage({ params: Promise.resolve({ projectId: 'saved-project' }) }))
      .rejects.toThrow('Sign in required');
    expect(routing.redirect).not.toHaveBeenCalled();
  });

  it('keeps the decoded project parameter inside a single route segment', async () => {
    await expect(ConversationPage({ params: Promise.resolve({ projectId: 'project/name' }) }))
      .rejects.toThrow('Redirect: /editor/project%2Fname');
  });

  it('opens the public sample in the full editor without requiring sign-in', () => {
    expect(() => DemoConversationPage()).toThrow('Redirect: /editor/demo');
    expect(routing.protect).not.toHaveBeenCalled();
  });

  it.each([LegacyChatPage, LegacyDashboardChatPage])('keeps checkout and repeated query parameters when opening the new-project route', async Page => {
    await expect(Page({ searchParams: Promise.resolve({ checkout: 'success', attachment: ['one', 'two'] }) }))
      .rejects.toThrow('Redirect: /dashboard/new-project?checkout=success&attachment=one&attachment=two');
  });

  it.each([
    ['success', '/dashboard/new-project?checkout=success'],
    ['canceled', '/profile?checkout=canceled#billing'],
    [undefined, '/profile#billing'],
  ])('routes the legacy billing return for %s', async (checkout, destination) => {
    await expect(BillingPage({ searchParams: Promise.resolve({ checkout }) }))
      .rejects.toThrow(`Redirect: ${destination}`);
  });
});
