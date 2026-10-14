import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), probe: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: async () => ({stdout: JSON.stringify(mocks.probe()), stderr: ''}) }) }));
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('META_MODEL_API_KEY', 'fixture-key');
  mocks.auth.mockResolvedValue({ userId: 'fixture-owner' });
  mocks.probe.mockReturnValue({ format: { duration: '2' }, streams: [{ codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '30/1', nb_frames: '60' }] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"type":"response.completed"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function request(prompt = 'person') {
  const form = new FormData(); form.append('video', new File(['fixture'], 'clip.mp4', { type: 'video/mp4' })); form.append('prompt', prompt);
  return new Request('http://localhost:3001/api/dev/sam', { method: 'POST', body: form });
}
test('production refuses all access before auth, key reads or processing', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect((await GET()).status).toBe(404); expect((await POST(request())).status).toBe(404);
  expect(mocks.auth).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test('requires sign-in and a server-only Meta key', async () => {
  mocks.auth.mockResolvedValueOnce({ userId: null }); expect((await POST(request())).status).toBe(401);
  vi.stubEnv('META_MODEL_API_KEY', ''); expect((await POST(request())).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  expect(await (await GET()).json()).toEqual({ configured: false });
});
test('validates actual video duration and frame count before any paid provider call', async () => {
  mocks.probe.mockReturnValue({ format: { duration: '18' }, streams: [{ codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '30/1', nb_frames: '540' }] });
  expect((await POST(request())).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  mocks.probe.mockReturnValue({ format: { duration: '2' }, streams: [{ codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '480/1', nb_frames: '960' }] });
  expect((await POST(request())).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
});
test('streams SAM video masks through the authenticated server without persisting uploads', async () => {
  const response = await POST(request(' red bicycle '));
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toContain('response.completed');
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('https://api.meta.ai/v1/responses');
  const body = JSON.parse(options!.body as string);
  expect(body.model).toBe('sam-3.1'); expect(body.stream).toBe(true); expect(body.metadata.mask_encoding).toBe('one_bit');
  expect(body.input[0].content).toEqual([{ type: 'input_text', text: 'red bicycle' }, { type: 'input_video', video_url: 'data:video/mp4;base64,Zml4dHVyZQ==' }]);
  expect(body).not.toHaveProperty('apiKey');
});
test.each([401, 402, 403, 404, 429, 500])('reports provider failure %s without leaking its response', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('private provider detail', { status }));
  const response = await POST(request());
  expect(response.status).toBe(status === 402 || status === 429 ? status : 502); expect(await response.text()).not.toContain('private provider detail');
});
