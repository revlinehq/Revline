// Requests between Convex and the Cloudflare agent runner carry an HMAC of their time, nonce, method, path and
// body under AGENT_RUNNER_SECRET, never the secret itself. A changed body or path fails, a captured request stops
// working after the window, and the receiver refuses a nonce it has seen. Shared by convex/agentRunnerHttp.ts and
// cf-workers/agent-runner.
export const RUNNER_REQUEST_WINDOW_MS = 2 * 60_000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const importKey = (secret: string, usage: 'sign' | 'verify') => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const message = async (time: string, nonce: string, method: string, path: string, body: ArrayBuffer) => encoder.encode(`${time}\n${nonce}\n${method.toUpperCase()}\n${path}\n${hex(await crypto.subtle.digest('SHA-256', body))}`);
const bytes = (body: string | ArrayBuffer | undefined) => typeof body === 'string' ? encoder.encode(body).buffer as ArrayBuffer : body ?? new ArrayBuffer(0);

export async function runnerSignature(secret: string, method: string, url: string, body?: string | ArrayBuffer): Promise<Record<string, string>> {
  const time = String(Date.now()), nonce = crypto.randomUUID();
  const signature = await crypto.subtle.sign('HMAC', await importKey(secret, 'sign'), await message(time, nonce, method, new URL(url).pathname, bytes(body)));
  return { 'x-runner-time': time, 'x-runner-nonce': nonce, 'x-runner-signature': hex(signature) };
}

/** Cheap rejection before a receiver allocates or hashes an untrusted body. */
export function runnerRequestHeadersValid(request:Request){
  const time=request.headers.get('x-runner-time')??'',nonce=request.headers.get('x-runner-nonce')??'',signature=request.headers.get('x-runner-signature')??'';
  return /^\d{1,16}$/.test(time)&&/^[\da-f-]{36}$/.test(nonce)&&/^[\da-f]{64}$/.test(signature)&&Math.abs(Date.now()-Number(time))<=RUNNER_REQUEST_WINDOW_MS;
}

/** The nonce of a request signed with this secret within the window, or null. Its body must be read as `body`;
 * the caller refuses a nonce it has already seen. */
export async function verifyRunnerRequest(secret: string | undefined, request: Request, body: ArrayBuffer): Promise<string | null> {
  const time = request.headers.get('x-runner-time') ?? '', nonce = request.headers.get('x-runner-nonce') ?? '', signature = request.headers.get('x-runner-signature') ?? '';
  if (!secret || !runnerRequestHeadersValid(request)) return null;
  const signed = new Uint8Array(signature.match(/../g)!.map(pair => parseInt(pair, 16)));
  return await crypto.subtle.verify('HMAC', await importKey(secret, 'verify'), signed, await message(time, nonce, request.method, new URL(request.url).pathname, body)) ? nonce : null;
}

/** The run a runner call acts for. Convex issues its token at start under AGENT_RUNNER_RUN_KEY, a key the runner
 * never holds, and checks every bridge call's ids against it: a run can only touch its own owner, project and chat. */
export type RunScope = { runId: string; ownerId: string; projectId: string; threadId: string };
const scopeMessage = (scope: RunScope) => encoder.encode(JSON.stringify(['run', scope.runId, scope.ownerId, scope.projectId, scope.threadId]));

export async function runToken(key: string, scope: RunScope) {
  return hex(await crypto.subtle.sign('HMAC', await importKey(key, 'sign'), scopeMessage(scope)));
}

export async function verifyRunToken(key: string | undefined, scope: RunScope, token: string) {
  if (!key || !/^[\da-f]{64}$/.test(token)) return false;
  return crypto.subtle.verify('HMAC', await importKey(key, 'verify'), new Uint8Array(token.match(/../g)!.map(pair => parseInt(pair, 16))), scopeMessage(scope));
}
