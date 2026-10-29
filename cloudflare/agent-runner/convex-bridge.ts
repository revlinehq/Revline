import { getFunctionAddress } from 'convex/server';
import { ConvexError, convexToJson, jsonToConvex, type JSONValue, type Value } from 'convex/values';
import type { ActionCtx } from '../../convex/_generated/server';
import { runnerSignature, type RunScope } from '../../convex/lib/runner_auth';

export type BridgeEnv = { CONVEX_SITE_URL: string; AGENT_RUNNER_SECRET: string };
type Reply = { value?: JSONValue; error?: { message: string; data?: JSONValue } };

/** The run a bridge acts for: the token Convex issued for it at start, and this attempt's claim on it. */
export type RunGrant = { scope: RunScope; token: string; claimId: string };

/** An action context whose calls run in Convex through /agent-runner/* (convex/agentRunnerHttp.ts), each one
 * signed and bound to this run. The turn's code and the agent component use it as they use a Convex action's ctx. */
export function convexBridge(env: BridgeEnv, grant: RunGrant) {
  const base = env.CONVEX_SITE_URL.replace(/\/+$/, '');
  const runHeaders = { 'x-runner-scope': JSON.stringify(grant.scope), 'x-runner-token': grant.token, 'x-runner-claim': grant.claimId };
  const send = async (path: string, init: RequestInit & { body?: string | ArrayBuffer }, attempts = 1): Promise<Value> => {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      // Signed per attempt: a retry is a new request, not a replay.
      try { response = await fetch(`${base}${path}`, { ...init, headers: { ...init.headers, ...runHeaders, ...await runnerSignature(env.AGENT_RUNNER_SECRET, init.method ?? 'GET', `${base}${path}`, init.body) } }); }
      catch (error) { if (attempt < attempts) { await new Promise(resolve => setTimeout(resolve, 500 * attempt)); continue; } throw error; }
      if (response.status >= 500 && attempt < attempts) { await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 500 * attempt)); continue; }
      if (!response.ok) throw new Error(`Convex answered ${response.status} on ${path}: ${(await response.text()).slice(0, 300)}`);
      const reply = await response.json() as Reply;
      if (reply.error) {
        // Keep Convex's own message: the turn recognizes some failures by their text.
        const error = reply.error.data !== undefined ? new ConvexError(jsonToConvex(reply.error.data)) : new Error(reply.error.message);
        error.message = reply.error.message;
        throw error;
      }
      return jsonToConvex(reply.value ?? null);
    }
  };
  // Reads are safe to repeat after a dropped connection; writes are sent once.
  const call = (kind: 'query' | 'mutation' | 'action') => (ref: unknown, args: Record<string, Value> = {}) =>
    send('/agent-runner/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, address: getFunctionAddress(ref), args: convexToJson(args) }) }, kind === 'query' ? 4 : 1);
  const storage = (op: 'getUrl' | 'delete' | 'getMetadata') => (storageId: string) =>
    send('/agent-runner/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'storage', op, storageId }) }, op === 'delete' ? 1 : 4);
  const ctx = {
    runQuery: call('query'), runMutation: call('mutation'), runAction: call('action'),
    storage: {
      store: async (blob: Blob) => send('/agent-runner/storage', { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: await blob.arrayBuffer() }),
      getUrl: storage('getUrl'), delete: storage('delete'), getMetadata: storage('getMetadata'),
    },
    auth: { getUserIdentity: async () => null },
  };
  return ctx as unknown as ActionCtx;
}
