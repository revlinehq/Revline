import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), mutation: vi.fn(), setAuth: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth = mocks.setAuth; mutation = mocks.mutation; } }));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://dev.convex.cloud');
  mocks.auth.mockResolvedValue({ userId: 'owner', getToken: mocks.token });
  mocks.token.mockResolvedValue('fixture-token'); mocks.mutation.mockResolvedValue('task-id');
});
afterEach(() => vi.unstubAllEnvs());
const request = (mode: string) => new Request('http://localhost:3001/api/analyze', { method: 'POST', body: JSON.stringify({ projectId: 'project', assetId: 'asset', mode }) });

test.each(['understand', 'transcribe', 'shots', 'beats', 'track'])('queues %s without waiting for processing or requiring a provider in Next', async mode => {
  const response = await POST(request(mode));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ taskId: 'task-id', status: 'queued' });
  expect(mocks.setAuth).toHaveBeenCalledWith('fixture-token');
  expect(mocks.mutation.mock.calls[0][1]).toEqual({ projectId: 'project', assetId: 'asset', kind: mode });
});
test('rejects signed-out requests before touching the queue', async () => {
  mocks.auth.mockResolvedValue({ userId: null });
  expect((await POST(request('understand'))).status).toBe(401);
  expect(mocks.token).not.toHaveBeenCalled(); expect(mocks.mutation).not.toHaveBeenCalled();
});
test('rejects malformed processing modes and unavailable sessions', async () => {
  expect((await POST(request('unsupported'))).status).toBe(400);
  expect(mocks.token).not.toHaveBeenCalled();
  mocks.token.mockResolvedValue(null);
  expect((await POST(request('shots'))).status).toBe(401);
  expect(mocks.mutation).not.toHaveBeenCalled();
});
test('does not leak details when Convex refuses a source owned by another user', async () => {
  mocks.mutation.mockRejectedValue(new Error('private source details'));
  const response = await POST(request('shots'));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Could not queue processing for this source.' });
});
