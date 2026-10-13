import { afterEach, expect, test, vi } from 'vitest';
import { Readable } from 'node:stream';
import { publicAddress, videoResponse, youtubeArguments, MAX_IMPORT_BYTES } from './import-video-link';
const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
afterEach(() => vi.resetAllMocks());
test('blocks private, mapped and reserved IP ranges including IPv6', () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.100.100.200', '169.254.169.254', '172.16.2.3', '192.168.1.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) expect(publicAddress(address)).toBe(false);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(publicAddress(address)).toBe(true);
});
function serve(statusCode = 200, headers: Record<string,string> = { 'content-type': 'video/mp4' }) {
  const response = Object.assign(Readable.from([]), { statusCode, headers });
  network.request.mockImplementation((_url: unknown, _options: unknown, callback: (response: unknown) => void) => {
    const req = { setTimeout: vi.fn(), on: vi.fn(), end: () => callback(response), destroy: vi.fn() };
    return req;
  });
  return response;
}
test('checks every resolved address and pins the socket to the approved public address', async () => {
  network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  serve(); await videoResponse('https://cdn.example.com/a.mp4', new AbortController().signal);
  const options = network.request.mock.calls[0][1] as { lookup: Function };
  const callback = vi.fn(); options.lookup('cdn.example.com', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '1.1.1.1', 4);
  network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await expect(videoResponse('https://cdn.example.com/a.mp4', new AbortController().signal)).rejects.toThrow('public video server');
  expect(network.request).toHaveBeenCalledTimes(1);
});
test('revalidates redirects and rejects HTML or oversized responses before writing', async () => {
  network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  serve(302, { location: 'https://127.0.0.1/private' });
  await expect(videoResponse('https://cdn.example.com/a.mp4', new AbortController().signal)).rejects.toThrow('public');
  serve(200, { 'content-type': 'text/html' });
  await expect(videoResponse('https://cdn.example.com/a.mp4', new AbortController().signal)).rejects.toThrow('webpage');
  serve(200, { 'content-type': 'video/mp4', 'content-length': String(MAX_IMPORT_BYTES+1) });
  await expect(videoResponse('https://cdn.example.com/a.mp4', new AbortController().signal)).rejects.toThrow('500 MB');
});
test('YouTube runs without user config, playlists, plugins or shell interpolation', () => {
  const args = youtubeArguments('https://www.youtube.com/watch?v=BaW_jenozKc', '/tmp/fixed-output.mp4');
  expect(args).toContain('--ignore-config'); expect(args).toContain('--no-plugin-dirs'); expect(args).toContain('--no-playlist');
  expect(args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=BaW_jenozKc']);
});
