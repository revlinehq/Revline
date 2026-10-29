import { ConvexError, convexToJson, jsonToConvex, type JSONValue } from 'convex/values';
import type { HttpRouter } from 'convex/server';
import { components, internal } from './_generated/api';
import { httpAction, type ActionCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { verifyRunToken, verifyRunnerRequest, type RunScope } from './lib/runner_auth';

// The Cloudflare agent runner calls the same internal functions a turn inside Convex would. Every call is signed
// with AGENT_RUNNER_SECRET under a single-use nonce, carries its run's token (lib/runner_auth.ts) and the id of
// the attempt that claimed the run, and must belong to a run the runner is still working on. Its owner, project, run and chat ids must be
// that run's, and only the functions a turn uses are reachable.
const TURN_FUNCTIONS = new Set([
  'agentRunner:claim', 'agentRunner:heartbeat', 'agentRunner:settle', 'agentRunner:release', 'aiCosts:record',
  'assistant:analysisRequest', 'assistant:apply', 'assistant:attachRunStockAudio', 'assistant:beginEditing', 'assistant:clearAnalysis', 'assistant:currentPrompt', 'assistant:finish', 'assistant:getRun', 'assistant:getRunAsset', 'assistant:getRunTimeline', 'assistant:isRunActive', 'assistant:previewDraft', 'assistant:recordBudget', 'assistant:recordEffort', 'assistant:requestAnalysis', 'assistant:saveGeneratedSound', 'assistant:undoLatestEdit',
  'blueprints:checkState', 'blueprints:getForTools', 'blueprints:listForTools', 'blueprints:requestCheck', 'blueprints:saveFromCheck', 'brandKits:create', 'brandKits:get', 'brandKits:list', 'brandKits:update',
  'compositionReview:cancel', 'compositionReview:completionState', 'compositionReview:get', 'compositionReview:readPlan', 'compositionReview:request', 'compositionReview:savePlan',
  'cutouts:startFromRun', 'derivations:runStatus', 'derivations:startFromRun', 'mcp:discardFrames', 'mcp:frames', 'mcp:requestFrames', 'memories:forRun', 'memories:forget', 'memories:recall', 'memories:remember',
]);
/** What streamText and saveMessage use: the chat's messages, its stream deltas and message files. */
const AGENT_FUNCTIONS = new Set(['files/addFile', 'files/get', 'files/useExistingFile', 'messages/addMessages', 'messages/finalizeMessage', 'messages/getMessagesByIds', 'messages/listMessagesByThreadId', 'messages/updateMessage', 'streams/abort', 'streams/addDelta', 'streams/create', 'streams/finish', 'threads/getThread']);
const AGENT_COMPONENT = '_reference/childComponent/agent/';
const SCOPED_IDS = { ownerId: 'ownerId', userId: 'ownerId', projectId: 'projectId', runId: 'runId', threadId: 'threadId' } as const;

type Address = { name?: string; reference?: string };
type Call = { kind: 'query' | 'mutation' | 'action'; address: Address; args: JSONValue } | { kind: 'storage'; op: 'getUrl' | 'delete' | 'getMetadata'; storageId: string };
type Run = RunScope & { storageIds: string[] };

/** A function the runner may call, and whether its results name message files the run may then read. */
function resolve(address: Address | undefined): { ref: unknown; label: string; files: boolean } | null {
  if (address?.name) return TURN_FUNCTIONS.has(address.name) ? { ref: address.name, label: address.name, files: false } : null;
  const path = address?.reference?.startsWith(AGENT_COMPONENT) ? address.reference.slice(AGENT_COMPONENT.length) : '';
  if (!AGENT_FUNCTIONS.has(path)) return null;
  return { ref: path.split('/').reduce((ref: Record<string, unknown>, part) => ref[part] as Record<string, unknown>, components.agent as unknown as Record<string, unknown>), label: `agent/${path}`, files: path.startsWith('files/') };
}

/** The run this request acts for: signed, carrying Convex's token for it, and still being worked on by the
 * attempt that claimed it (or making that claim). Null otherwise. */
async function authorizedRun(ctx: ActionCtx, request: Request, body: ArrayBuffer, claiming = false): Promise<Run | null> {
  const nonce = await verifyRunnerRequest(process.env.AGENT_RUNNER_SECRET, request, body);
  if (!nonce) return null;
  let scope: RunScope;
  try { scope = JSON.parse(request.headers.get('x-runner-scope') ?? ''); } catch { return null; }
  if (![scope?.runId, scope?.ownerId, scope?.projectId, scope?.threadId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)) return null;
  if (!await verifyRunToken(process.env.AGENT_RUNNER_RUN_KEY, scope, request.headers.get('x-runner-token') ?? '')) return null;
  const turn = await ctx.runQuery(internal.agentRunner.turnState, { runId: scope.runId });
  if (!turn || turn.ownerId !== scope.ownerId || turn.projectId !== scope.projectId) return null;
  if (!claiming && (!turn.claimId || turn.claimId !== request.headers.get('x-runner-claim'))) return null;
  // Last, so only an otherwise valid request spends its nonce: a replay is refused here.
  if (!await ctx.runMutation(internal.agentRunner.useNonce, { nonce })) return null;
  return { ...scope, storageIds: turn.storageIds };
}

/** Every owner, project, run or chat id a call names must be its run's own. */
function outOfScope(args: unknown, run: RunScope) {
  if (!args || typeof args !== 'object') return false;
  return Object.entries(SCOPED_IDS).some(([field, key]) => (args as Record<string, unknown>)[field] != null && (args as Record<string, unknown>)[field] !== run[key]);
}
/** Storage ids in an agent files result: the chat's own attachments, which this run may read next. */
const fileStorageIds = (value: unknown): string[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(fileStorageIds) : typeof (value as { storageId?: unknown }).storageId === 'string' ? [(value as { storageId: string }).storageId] : [];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unauthorized = () => new Response('Unauthorized', { status: 401 });
const forbidden = (label: string, runId: string) => {
  console.warn(`[agent-runner] ${JSON.stringify({ event: 'call-refused', function: label.slice(0, 120), runId })}`);
  return json({ error: { message: 'The agent runner cannot make that call for this run.' } }, 403);
};
const failure = (error: unknown) => json({ error: { message: error instanceof Error ? error.message : 'The call failed.', ...(error instanceof ConvexError ? { data: convexToJson(error.data) } : {}) } });

export function registerAgentRunnerRoutes(http: HttpRouter) {
  http.route({ path: '/agent-runner/call', method: 'POST', handler: httpAction(async (ctx, request) => {
    const body = await request.arrayBuffer();
    let call: Call;
    try { call = JSON.parse(new TextDecoder().decode(body)); } catch { return unauthorized(); }
    const run = await authorizedRun(ctx, request, body, call?.kind !== 'storage' && call?.address?.name === 'agentRunner:claim');
    if (!run) return unauthorized();
    try {
      if (call.kind === 'storage') {
        // Files this run stored or the chat handed it; for links, also this project's own media.
        const storageId = call.storageId as Id<'_storage'>;
        const own = typeof storageId === 'string' && (run.storageIds.includes(storageId) || (call.op === 'getUrl' && await ctx.runQuery(internal.agentRunner.projectStorage, { ownerId: run.ownerId, projectId: run.projectId as Id<'projects'>, storageId })));
        if (!own) return forbidden(`storage/${call.op}`, run.runId);
        const value = call.op === 'getUrl' ? await ctx.storage.getUrl(storageId) : call.op === 'delete' ? await ctx.storage.delete(storageId) : await ctx.storage.getMetadata(storageId);
        return json({ value: value ?? null });
      }
      const target = resolve(call.address);
      if (!target) return forbidden(call.address?.name ?? call.address?.reference ?? 'unknown', run.runId);
      const args = jsonToConvex(call.args) as never;
      if (outOfScope(args, run)) return forbidden(target.label, run.runId);
      const ref = target.ref as never;
      const value = call.kind === 'query' ? await ctx.runQuery(ref, args) : call.kind === 'mutation' ? await ctx.runMutation(ref, args) : await ctx.runAction(ref, args);
      if (target.files) { const granted = fileStorageIds(value); if (granted.length) await ctx.runMutation(internal.agentRunner.grantStorage, { runId: run.runId, storageIds: granted }); }
      return json({ value: convexToJson((value ?? null) as never) });
    } catch (error) { return failure(error); }
  }) });
  http.route({ path: '/agent-runner/storage', method: 'POST', handler: httpAction(async (ctx, request) => {
    const body = await request.arrayBuffer(), run = await authorizedRun(ctx, request, body);
    if (!run) return unauthorized();
    try {
      const storageId = await ctx.storage.store(new Blob([body], { type: request.headers.get('content-type') ?? 'application/octet-stream' }));
      await ctx.runMutation(internal.agentRunner.grantStorage, { runId: run.runId, storageIds: [storageId] });
      return json({ value: storageId });
    } catch (error) { return failure(error); }
  }) });
}
