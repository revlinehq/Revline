import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceChats } from './workspace-nav';

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true, isAuthenticated: false, isLoading: false }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => auth, useClerk: () => ({}) }));
vi.mock('convex/react', () => ({ useConvexAuth: () => auth, useQuery: () => undefined }));

function ChatStatus() {
  const { loading } = useWorkspaceChats();
  return <span>{loading ? 'Loading chats' : 'Chats ready'}</span>;
}

describe('chat history connection states', () => {
  beforeEach(() => Object.assign(auth, { isLoaded: true, isSignedIn: true, isAuthenticated: false, isLoading: false }));

  it('does not keep loading a skipped project query after authentication stops', () => {
    expect(renderToStaticMarkup(<ChatStatus />)).toContain('Chats ready');
  });

  it('waits while authentication connects', () => {
    auth.isLoading = true;
    expect(renderToStaticMarkup(<ChatStatus />)).toContain('Loading chats');
  });

  it('waits for the project query only after authentication succeeds', () => {
    auth.isAuthenticated = true;
    expect(renderToStaticMarkup(<ChatStatus />)).toContain('Loading chats');
  });
});
