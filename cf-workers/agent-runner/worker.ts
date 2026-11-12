import { Agent, getAgentByName, type FiberContext, type FiberRecoveryContext } from 'agents';
import { jsonToConvex, type JSONValue } from 'convex/values';
import { internal } from '../../convex/_generated/api';
import { runEditorTurn, type EditorTurnArgs } from '../../convex/lib/editorTurn';
import { runnerRequestHeadersValid, verifyRunnerRequest } from '../../convex/lib/runner_auth';
import { convexBridge, type BridgeEnv } from './convex-bridge';

// Runs the editor's agent loop for one chat turn (convex/lib/editorTurn.ts) outside Convex's ten-minute action
// limit. Each run is its own Agents SDK agent (a Durable Object): the turn is a durable fiber that keeps the
// object alive while it works and, if Cloudflare evicts it anyway, resumes from its last finished step.
// Convex starts and stops runs (convex/agentRunner.ts) and keeps the data; agents are never routed publicly.
/** Bindings from wrangler.jsonc (worker-configuration.d.ts) and the AGENT_RUNNER_SECRET secret. */
type Env = Cloudflare.Env & BridgeEnv;
/** What Convex sends to start a run: its arguments and the token that scopes its calls back. */
type RunStart = { args: JSONValue; runToken: string };
/** What survives an eviction: the request, and how far the turn had got. */
type TurnCheckpoint = RunStart & { steps: number; savedEdits: number; pendingFastFrames?: number[] };
const HEARTBEAT_MS = 30_000;

const MAX_START_BYTES=1_000_000;
async function readStartBody(request:Request):Promise<ArrayBuffer|null>{
  const reader=request.body?.getReader();
  if(!reader)return new ArrayBuffer(0);
  const chunks:Uint8Array[]= [];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_START_BYTES){await reader.cancel();return null;}chunks.push(value);}
  }finally{reader.releaseLock();}
  const body=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  return body.buffer;
}

export class EditorTurn extends Agent<Env> {
  /** Convex's signed start and stop requests for this run, each accepted once: a replay is refused. */
  firstUse(nonce: string): boolean {
    this.sql`CREATE TABLE IF NOT EXISTS runner_nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL)`;
    if (this.sql`SELECT nonce FROM runner_nonces WHERE nonce = ${nonce}`.length) return false;
    this.sql`INSERT INTO runner_nonces (nonce, at) VALUES (${nonce}, ${Date.now()})`;
    return true;
  }

  /** Accept a run and return at once; a repeated start for the same run is not run twice. */
  async begin(start: RunStart): Promise<{ accepted: boolean }> {
    const args=jsonToConvex(start.args) as EditorTurnArgs;
    const { runId } = args;
    const receipt = await this.startFiber('turn', fiber => this.turn(fiber, { args: start.args, runToken: start.runToken, steps: 0, savedEdits: args.continuation?.savedEdits??0 }), { idempotencyKey: `${runId}:${args.continuation?.segment??0}` });
    return { accepted: receipt.accepted };
  }

  /** Stop pressed in the editor: abort the model call now rather than at the turn's next check. */
  async stop(): Promise<number> {
    const running = await this.listFibers({ name: 'turn', status: ['pending', 'running'] });
    for (const fiber of running) await this.cancelFiber(fiber.fiberId, 'Stopped by the user.');
    return running.length;
  }

  /** Cloudflare evicted the object mid-turn: continue the same request from the saved thread and timeline. */
  async onFiberRecovered(recovery: FiberRecoveryContext) {
    if (recovery.name !== 'turn') return;
    const checkpoint = recovery.snapshot as TurnCheckpoint | null;
    if (!checkpoint) return { status: 'error' as const, error: 'The interrupted turn left no checkpoint.' };
    const { runId } = jsonToConvex(checkpoint.args) as EditorTurnArgs;
    console.log(`[agent-runner] ${JSON.stringify({ event: 'turn-recovered', runId, steps: checkpoint.steps, savedEdits: checkpoint.savedEdits })}`);
    await this.startFiber('turn', fiber => this.turn(fiber, checkpoint), { idempotencyKey: `${runId}:${recovery.id}` });
    return { status: 'completed' as const };
  }

  private async turn(fiber: FiberContext, checkpoint: TurnCheckpoint) {
    fiber.stash(checkpoint);
    const args = jsonToConvex(checkpoint.args) as EditorTurnArgs;
    const run = { projectId: args.projectId, ownerId: args.ownerId, runId: args.runId };
    const claimId = crypto.randomUUID();
    const ctx = convexBridge(this.env, { scope: { ...run, threadId: args.threadId }, token: checkpoint.runToken, claimId });
    try {
      // Convex counts attempts: the first is the request, later ones are resumptions after an eviction. Calls
      // from an attempt that was replaced carry an old claim and are refused.
      const claim = await ctx.runMutation(internal.agentRunner.claim, { ...run, claimId });
      if (!claim) return;
      if (claim.attempt >= claim.maxAttempts) throw new Error(`The turn was interrupted ${claim.attempt} times.`);
      // Stop reaches the turn two ways, so it does not poll: /runs/stop cancels this fiber at once, and a heartbeat that
      // finds the run no longer active (stopped, replaced or ended elsewhere) aborts it within 30 seconds. Writes after
      // Stop are refused in Convex either way.
      const ended = new AbortController();
      const endTurn = () => ended.abort(fiber.signal.reason);
      if (fiber.signal.aborted) endTurn(); else fiber.signal.addEventListener('abort', endTurn, { once: true });
      // A refused heartbeat (401/403) means Convex no longer holds this run for the runner: it ended too.
      const over = () => ended.abort(new Error('The run is no longer active.'));
      const beat = setInterval(() => { void ctx.runMutation(internal.agentRunner.heartbeat, run).then(active => { if (active === false) over(); }, error => { if (/answered 40[13]\b/.test(error instanceof Error ? error.message : '')) over(); }); }, HEARTBEAT_MS);
      try {
        await runEditorTurn(ctx, { ...args, ...(claim.attempt ? { continuation: { segment: claim.attempt, savedEdits: checkpoint.savedEdits, pendingFastFrames: checkpoint.pendingFastFrames } } : {}) }, {
          signal: ended.signal, pollActive: false,
          // savedEdits already counts the edits saved before this attempt.
          onStepFinished: progress => fiber.stash({ ...checkpoint, steps: checkpoint.steps + progress.steps, savedEdits: progress.savedEdits, pendingFastFrames: progress.pendingFastFrames }),
        });
      } finally { clearInterval(beat); fiber.signal.removeEventListener('abort', endTurn); }
      await ctx.runMutation(internal.agentRunner.release, run).catch(() => {});
    } catch (error) {
      // The turn reports its own failures; this is the bridge or the runner itself failing.
      console.error(`[agent-runner] ${JSON.stringify({ event: 'turn-failed', projectId: run.projectId, runId: run.runId, error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' })}`);
      await ctx.runMutation(internal.incidents.reportRunner, { ...run, message: error instanceof Error ? error.message : 'Runner failed', stack: error instanceof Error ? error.stack : undefined }).catch(() => {});
      await ctx.runMutation(internal.agentRunner.settle, run).catch(failure => console.error(`[agent-runner] ${JSON.stringify({ event: 'settle-failed', projectId: run.projectId, runId: run.runId, error: failure instanceof Error ? failure.message.slice(0, 300) : 'unknown' })}`));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return Response.json({ ok: true });
    if (request.method !== 'POST' || (path !== '/runs' && path !== '/runs/stop')) return new Response('Not found', { status: 404 });
    if(Number(request.headers.get('content-length'))>MAX_START_BYTES)return new Response('Request is too large',{status:413});
    if(!env.AGENT_RUNNER_SECRET||!runnerRequestHeadersValid(request))return new Response('Unauthorized',{status:401});
    let body:ArrayBuffer|null;
    try{body=await readStartBody(request);}catch{return new Response('Invalid request body',{status:400});}
    if(!body)return new Response('Request is too large',{status:413});
    const nonce = await verifyRunnerRequest(env.AGENT_RUNNER_SECRET, request, body);
    if (!nonce) return new Response('Unauthorized', { status: 401 });
    let params: { runId?: unknown; args?: { runId?: unknown }; runToken?: unknown } | null = null;
    try { params = JSON.parse(new TextDecoder().decode(body)); } catch { /* answered below */ }
    const runId = path === '/runs/stop' ? params?.runId : params?.args?.runId;
    if (typeof runId !== 'string' || !/^[\w.-]{1,100}$/.test(runId)) return Response.json({ error: 'Missing runId.' }, { status: 400 });
    // One agent per run, reached only through this signed Worker route: there is no routeAgentRequest.
    const agent = await getAgentByName(env.EDITOR_TURN, runId);
    if (!await agent.firstUse(nonce)) return new Response('Unauthorized', { status: 401 });
    if (path === '/runs/stop') return Response.json({ stopped: await agent.stop() });
    if (typeof params?.runToken !== 'string') return Response.json({ error: 'Missing run token.' }, { status: 400 });
    return Response.json(await agent.begin({ args: params.args as JSONValue, runToken: params.runToken }), { status: 202 });
  },
} satisfies ExportedHandler<Env>;
