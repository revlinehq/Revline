import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverAuthorizationServerMetadata, exchangeAuthorization, registerClient, startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createServer, request, type ClientRequest } from 'node:http';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { run, state } from './shared';

const credentialFile = join(state, 't3-mcp.json');
const credentialSchema = z.object({ token: z.string(), expiresAt: z.number() });

// T3 can bind only to this host's VPN address. Keep OAuth and MCP on loopback,
// without restarting T3 or exposing another listening socket to the network.
async function localServer<T>(action: (url: URL) => Promise<T>, preserveOrigin = false) {
  const runtime = z.object({ host: z.string(), port: z.number(), origin: z.string().url() }).parse(JSON.parse(await readFile(join(process.env.T3CODE_HOME ?? join(homedir(), '.t3'), 'userdata/server-runtime.json'), 'utf8')));
  const addresses = Object.values(networkInterfaces()).flatMap(items => items?.map(item => item.address) ?? []);
  if (!['localhost', '0.0.0.0', '::', ...addresses].includes(runtime.host)) throw new Error('T3 must be running on this machine');
  const host = runtime.host === '0.0.0.0' ? '127.0.0.1' : runtime.host === '::' ? '::1' : runtime.host;
  const requests = new Set<ClientRequest>();
  const server = createServer((incoming, response) => {
    const outgoing = request({ hostname: host, port: runtime.port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, ...(preserveOrigin ? { host: new URL(runtime.origin).host } : {}) } }, upstream => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
      response.once('close', () => upstream.destroy());
    });
    requests.add(outgoing);
    outgoing.once('close', () => requests.delete(outgoing));
    outgoing.once('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    incoming.once('aborted', () => outgoing.destroy());
    incoming.pipe(outgoing);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local MCP address');
  try { return await action(new URL(`http://127.0.0.1:${address.port}/mcp`)); }
  finally { for (const request of requests) request.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

export async function authorizeT3(binary: string) {
  // Outside-agents OAuth: dynamic registration, PKCE, one-use scoped pairing
  // approval, then exchange the code. Credentials never reach stdout or argv.
  await localServer(async url => {
    const metadata = await discoverAuthorizationServerMetadata(url.origin);
    const redirectUri = 'http://127.0.0.1/revline-incidents';
    const client = await registerClient(url.origin, { metadata, clientMetadata: { client_name: 'Revline incident listener', redirect_uris: [redirectUri], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' } });
    const nonce = randomUUID();
    const { authorizationUrl, codeVerifier } = await startAuthorization(url.origin, { metadata, clientInformation: client, redirectUrl: redirectUri, scope: 'orchestration:read orchestration:operate', state: nonce, resource: url.href });
    const issued = await run(binary, ['auth', 'pairing', 'create', '--scope', 'orchestration:read', '--scope', 'orchestration:operate', '--scope', 'settings:write', '--scope', 'source-control:write', '--ttl', '5m', '--label', 'Revline incident listener OAuth', '--json']).catch(() => { throw new Error('Could not create the local T3 MCP approval grant'); });
    const pairing = z.object({ credential: z.string() }).parse(JSON.parse(issued.stdout));
    const response = await fetch(new URL('/oauth/mcp/decision', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorization: Object.fromEntries(authorizationUrl.searchParams), decision: { _tag: 'pairing-code', code: pairing.credential, access: 'full-access' } }) });
    if (!response.ok) {
      const error = z.object({ message: z.string().optional() }).parse(await response.json());
      throw new Error(`T3 MCP approval failed (${response.status}): ${error.message ?? 'check T3 access settings'}`);
    }
    const redirect = new URL(z.object({ redirectTo: z.string() }).parse(await response.json()).redirectTo);
    const code = redirect.searchParams.get('code');
    if (!code || redirect.searchParams.get('state') !== nonce || redirect.searchParams.get('iss') !== url.origin) throw new Error('Invalid T3 OAuth callback');
    const tokens = await exchangeAuthorization(url.origin, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri, resource: url.href });
    await writeFile(credentialFile, JSON.stringify({ token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000 }), { mode: 0o600 });
    await chmod(credentialFile, 0o600);
  });
}

export async function withT3<T>(action: (client: Client) => Promise<T>) {
  const credential = credentialSchema.parse(JSON.parse(await readFile(credentialFile, 'utf8')));
  if (credential.expiresAt <= Date.now()) throw new Error('T3 MCP sign-in expired; rerun npm run incidents:install');
  return await localServer(async url => {
    const client = new Client({ name: 'Revline incident listener', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${credential.token}` } } });
    try { await client.connect(transport); return await action(client); }
    finally { await client.close(); }
  }, true);
}

export async function callT3(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  if (result.isError) throw new Error(`T3 ${name} failed; inspect the thread in T3 Code`);
  if (result.structuredContent) return result.structuredContent;
  const content = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(result.content);
  return z.record(z.string(), z.unknown()).parse(JSON.parse(content.find(item => item.type === 'text')?.text ?? '{}'));
}
