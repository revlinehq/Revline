import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceChats } from './workspace-nav';

const query = vi.hoisted(() => vi.fn((_ref: unknown, _args: unknown) => undefined));
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true, isAuthenticated: false, isLoading: false }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => auth, useClerk: () => ({}) }));
vi.mock('convex/react', () => ({ useConvexAuth: () => auth, useQuery: query }));

function ChatStatus({enabled=true}: {enabled?:boolean}) {
  const { loading } = useWorkspaceChats(false,enabled,4);
  return <span>{loading ? 'Loading chats' : 'Chats ready'}</span>;
}

describe('chat history connection states', () => {
  beforeEach(() => {query.mockClear();Object.assign(auth, { isLoaded: true, isSignedIn: true, isAuthenticated: false, isLoading: false });});

  it('does not keep loading a skipped project query after authentication stops', () => {
    expect(renderToStaticMarkup(<ChatStatus />)).toContain('Chats ready');
  });

  it('skips closed history and fetches only four menu entries when opened', () => {
    auth.isAuthenticated = true;
    expect(renderToStaticMarkup(<ChatStatus enabled={false}/>)).toContain('Chats ready');
    expect(query.mock.calls.at(-1)?.[1]).toBe('skip');
    renderToStaticMarkup(<ChatStatus/>);
    expect(query.mock.calls.at(-1)?.[1]).toEqual({limit:4});
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
