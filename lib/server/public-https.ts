import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2002::', 16]] as const) blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const publicAddress = (address: string) => isIP(address) === 4 ? !blocked.check(address, 'ipv4') : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');

/** Untrusted remote resources: validate every hop, pin DNS and bound bytes while reading. */
export async function downloadPublicHttps(value: string, options: { maxBytes: number; signal?: AbortSignal; headers?: Record<string, string> }) {
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  let url = new URL(value);
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('Resources need public HTTPS URLs without credentials.');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Resources must point to a public server.');
    const selected = addresses.find(item => item.family === 4) ?? addresses[0];
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(url, { signal, agent: false, headers: { ...options.headers, 'accept-encoding': 'identity' }, lookup: (_hostname, settings, callback) => {
        if (settings.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
      } }, resolve);
      req.on('error', reject);
      req.end();
    });
    try {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        if (!response.headers.location || redirects >= 5) throw new Error('Resource redirects too many times.');
        url = new URL(response.headers.location, url);
        continue;
      }
      if (response.statusCode !== 200) throw new Error(`Resource server answered ${response.statusCode}.`);
      if (Number(response.headers['content-length']) > options.maxBytes) throw new Error('Resource is too large.');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > options.maxBytes) throw new Error('Resource is too large.');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, type: response.headers['content-type'] ?? '', url: url.href };
    } finally { response.destroy(); }
  }
}
