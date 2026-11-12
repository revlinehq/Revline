import { plainFailureText } from '../../lib/ai/failure-text';
import { RUN_FAILURE_CODES, runFailureOf, type RunFailureCode } from '../../lib/ai/run-failure';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { z } from 'zod';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { toolBehavior, type ToolBehavior } from '../../lib/ai/tool-definitions';
import type { ToolSaveReceipt } from '../../lib/ai/save-confirmation';
import type { EditorRun } from './run_types';
import { savesNothing } from './tool_write_receipt';

type Execution = { name: string; callId:string; writes:Map<string,number>; behavior: ToolBehavior; receipt?: ToolSaveReceipt; recovered?: number; writeFailed?: { message: string; code?: RunFailureCode }; interrupted?: string; responseLost?: boolean };
class RecoveredWrite extends Error {}
const object = z.record(z.string(), z.unknown());
const writeFailure = z.object({ kind: z.literal('tool-write-failed'), message: z.string(), code: z.enum(RUN_FAILURE_CODES).optional() });
// The reason without Convex's transport wrapping, so the model and the chat read what actually went wrong.
const message = (error: unknown) => { const raw = error instanceof Error ? error.message : String(error); return (plainFailureText(raw) || raw).slice(0, 1000); };

/** One field the model can quote: the flags beside it are easy to misread once the draft is published later. */
const SAVE_STATES: Record<ToolSaveReceipt['status'], string> = {
  saved: 'saved',
  staged: 'staged in this run, NOT saved yet: the saved timeline has not changed. It becomes a saved revision only when finish passes or this request ends. Do not tell the user it is saved, and do not describe an undo, until a result says saved',
  unchanged: 'unchanged',
  queued: 'queued',
  failed: 'not saved',
  interrupted: 'not confirmed',
};

/** Async scopes keep concurrent tool calls from claiming one another's writes. */
export class ToolSaveReceipts {
  private active = new AsyncLocalStorage<Execution>();
  private stagedBy?: string;
  private completed=new Map<string,Promise<unknown>>();
  constructor(private run: EditorRun,private segment=0) {}

  restoredDraft() { this.stagedBy='restoreTimeline'; }

  private stamp(output: unknown, receipt: ToolSaveReceipt) {
    const parsed = object.safeParse(output);
    // A draft's own markers never survive onto the saved result that replaces it.
    const { savedRevision: _saved, draftOnRevision: _draft, ...result } = (parsed.success ? parsed.data : { result: output ?? null }) as Record<string, unknown>;
    // `revision` alone reads as "saved as revision N" on a draft, where it is only the revision the draft is built on.
    // The sentence beside it says which of the two it is, so a reply cannot honestly report a draft as saved.
    const saveState = receipt.status === 'saved' && receipt.kind === 'timeline' ? `saved as revision ${receipt.revision}; Undo is available for it`
      : receipt.status === 'staged' ? `${SAVE_STATES.staged} (still revision ${receipt.revision})` : SAVE_STATES[receipt.status];
    return { ...result, saved: receipt.status === 'saved', unchanged: receipt.status === 'unchanged' || receipt.status === 'queued', staged: receipt.status === 'staged', revision: receipt.revision, ...(receipt.status === 'staged' ? { savedRevision: null, draftOnRevision: receipt.revision } : receipt.status === 'saved' && receipt.kind === 'timeline' ? { savedRevision: receipt.revision } : {}), saveState, saveReceipt: receipt };
  }

  publishedResult(output: unknown, revision: number) {
    return { ...this.stamp(output, { kind: 'timeline', status: 'saved', revision }), applied: true };
  }

  private record(receipt: ToolSaveReceipt) {
    const execution = this.active.getStore();
    if (!execution) return;
    if (receipt.status === 'staged') this.stagedBy = execution.name;
    if (execution.receipt?.kind === 'timeline' && receipt.kind !== 'timeline') return;
    // A later no-op or queued job cannot erase a write that already committed.
    if (execution.receipt?.status === 'saved' && receipt.status !== 'saved' && receipt.status !== 'staged') return;
    execution.receipt = receipt;
  }

  /** Final publication runs after the tools; retain its originating tool and recover a lost acknowledgement. */
  async commit(write: () => Promise<number>): Promise<number> {
    const active = this.active.getStore();
    if (active) {
      // A check tool publishing its checked draft has no result stamping to recover a lost response for it:
      // take the committed revision from the receipt, as the end-of-request publication below does.
      if (!savesNothing(active.behavior.effect)) return write();
      active.recovered = undefined;
      try { return await write(); }
      catch (error) { if (active.recovered !== undefined) return active.recovered; throw error; }
    }
    const name = this.stagedBy, behavior = name ? toolBehavior(name) : undefined;
    if (!name || !behavior) throw new Error('A timeline publication must have an originating tool.');
    const execution: Execution = { name, behavior,callId:'publication',writes:new Map() };
    return this.active.run(execution, async () => {
      try { return await write(); }
      catch (error) {
        if (execution.receipt?.kind === 'timeline' && execution.receipt.status === 'saved') return execution.receipt.revision;
        throw error;
      }
    });
  }

  checkpoint(result: { staged: boolean; unchanged?: boolean; revision: number }) {
    if (result.unchanged || !result.staged) return;
    this.record({ kind: 'timeline', status: 'staged', revision: result.revision });
  }

  /** Every editing-tool mutation crosses the same atomic revision/receipt boundary. */
  context(ctx: ActionCtx): ActionCtx {
    const runMutation: ActionCtx['runMutation'] = async (ref, ...args) => {
      const execution = this.active.getStore();
      const input=args[0]??{},functionName=getFunctionName(ref);
      // A check tool (finish, checkClip) saves nothing itself, but it publishes the staged draft once its checks pass.
      // That save takes the receipt path like any other, so a lost response is recovered instead of read as "not saved".
      const publication=functionName==='assistant:apply'&&'stagedPublication' in input&&input.stagedPublication===true;
      if (!execution || savesNothing(execution.behavior.effect)&&!publication) return ctx.runMutation(ref, ...args);
      const ordinal=execution.writes.get(functionName)??0;
      execution.writes.set(functionName,ordinal+1);
      const writeId = `${this.run.runId}:${execution.callId}:${functionName}:${execution.callId==='publication'&&'expectedRevision' in input?String(input.expectedRevision):ordinal}`;
      for(let attempt=0; ; attempt++)try {
        const result = await ctx.runMutation(internal.toolWrites.run, { ...this.run, writeId, toolName: execution.name, functionName, input,segment:this.segment });
        if (result.receipt) this.record(result.receipt);
        if(result.replayed&&attempt===0&&result.receipt?.kind==='timeline'){
          execution.responseLost=true;execution.recovered=result.receipt.revision;
          throw new RecoveredWrite('This edit already committed. Inspect the saved state and continue only unfinished work.');
        }
        // The nested mutation validates this value against the original function's return validator.
        return result.value;
      } catch (error) {
        if(error instanceof RecoveredWrite)throw error;
        const rejected = writeFailure.safeParse(error instanceof ConvexError ? error.data : undefined);
        if (rejected.success) execution.writeFailed = { message: rejected.data.message, ...(rejected.data.code ? { code: rejected.data.code } : {}) };
        else {
          // Give a late acknowledgement time to arrive. Replays carry the same
          // identity and return the original transaction's result without another write.
          if(attempt<2){await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));continue;}
          const receipt = await ctx.runQuery(internal.toolWrites.receipt, { ...this.run, writeId }).catch(() => null);
          if (receipt) { this.record(receipt); execution.responseLost = true; if (receipt.kind === 'timeline') execution.recovered = receipt.revision; }
          else execution.interrupted = message(error);
        }
        throw error;
      }
    };
    return { ...ctx, runMutation };
  }

  async execute(name: string, revision: () => number, execute: () => Promise<unknown>, reconcile: () => Promise<void>,callId:string=crypto.randomUUID()) {
    const behavior = toolBehavior(name);
    if (!behavior) throw new Error(`Tool ${name} has no behavior definition.`);
    const key=`${name}:${callId}`,previous=this.completed.get(key);
    if(previous)return previous;
    const execution: Execution = { name, behavior,callId,writes:new Map() };
    const pending=this.active.run(execution, async () => {
      let output: unknown;
      try { output = await execute(); }
      catch (error) {
        if (savesNothing(behavior.effect)) throw error;
        // An uncoded error stays uncoded: its sentence is read the way it was before codes.
        const code = runFailureOf(error)?.code;
        output = { success: false, error: message(error), ...(code ? { errorCode: code } : {}) };
      }
      if (savesNothing(behavior.effect)) return output;
      if (execution.receipt?.kind === 'timeline' && execution.receipt.status === 'saved' && (execution.responseLost||execution.receipt.revision > revision())) await reconcile();
      if (execution.responseLost && execution.receipt) output = { recovered: true, note: 'The write committed. Its response was interrupted; inspect the saved state before continuing.' };
      const kind = behavior.effect;
      const receipt: ToolSaveReceipt = execution.receipt
        ?? (execution.writeFailed ? { kind, status: 'failed', revision: revision(), message: execution.writeFailed.message, ...(execution.writeFailed.code ? { code: execution.writeFailed.code } : {}) }
          : execution.interrupted ? { kind, status: 'interrupted', revision: revision(), message: execution.interrupted, code: 'unavailable' }
            : { kind, status: 'unchanged', revision: revision() });
      return this.stamp(output, receipt);
    });
    if(!savesNothing(behavior.effect))this.completed.set(key,pending);
    try {
      const result=await pending;
      if(result&&typeof result==='object'&&'success' in result&&result.success===false)this.completed.delete(key);
      return result;
    } catch(error) {this.completed.delete(key);throw error;}
  }
}
