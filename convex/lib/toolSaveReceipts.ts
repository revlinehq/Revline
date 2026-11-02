import { AsyncLocalStorage } from 'node:async_hooks';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { z } from 'zod';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { toolBehavior, type ToolBehavior } from '../../lib/ai/tool-definitions';
import type { ToolSaveReceipt } from '../../lib/ai/save-confirmation';
import type { EditorRun } from './editorToolkit';

type Execution = { name: string; callId:string; writes:Map<string,number>; behavior: ToolBehavior; receipt?: ToolSaveReceipt; writeFailed?: string; interrupted?: string; responseLost?: boolean };
class RecoveredWrite extends Error {}
const object = z.record(z.string(), z.unknown());
const writeFailure = z.object({ kind: z.literal('tool-write-failed'), message: z.string() });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

/** Async scopes keep concurrent tool calls from claiming one another's writes. */
export class ToolSaveReceipts {
  private active = new AsyncLocalStorage<Execution>();
  private stagedBy?: string;
  private completed=new Map<string,Promise<unknown>>();
  constructor(private run: EditorRun,private segment=0) {}

  restoredDraft() { this.stagedBy='restoreTimeline'; }

  private stamp(output: unknown, receipt: ToolSaveReceipt) {
    const parsed = object.safeParse(output);
    const result = parsed.success ? parsed.data : { result: output ?? null };
    return { ...result, saved: receipt.status === 'saved', unchanged: receipt.status === 'unchanged' || receipt.status === 'queued', staged: receipt.status === 'staged', revision: receipt.revision, saveReceipt: receipt };
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
    if (this.active.getStore()) return write();
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
      if (!execution || execution.behavior.effect === 'read' || execution.behavior.effect === 'analysis') return ctx.runMutation(ref, ...args);
      const input=args[0]??{},functionName=getFunctionName(ref);
      const ordinal=execution.writes.get(functionName)??0;
      execution.writes.set(functionName,ordinal+1);
      const writeId = `${this.run.runId}:${execution.callId}:${functionName}:${execution.callId==='publication'&&'expectedRevision' in input?String(input.expectedRevision):ordinal}`;
      for(let attempt=0; ; attempt++)try {
        const result = await ctx.runMutation(internal.toolWrites.run, { ...this.run, writeId, toolName: execution.name, functionName, input,segment:this.segment });
        if (result.receipt) this.record(result.receipt);
        if(result.replayed&&attempt===0&&result.receipt?.kind==='timeline'){
          execution.responseLost=true;
          throw new RecoveredWrite('This edit already committed. Inspect the saved state and continue only unfinished work.');
        }
        // The nested mutation validates this value against the original function's return validator.
        return result.value;
      } catch (error) {
        if(error instanceof RecoveredWrite)throw error;
        const rejected = writeFailure.safeParse(error instanceof ConvexError ? error.data : undefined);
        if (rejected.success) execution.writeFailed = rejected.data.message;
        else {
          // Give a late acknowledgement time to arrive. Replays carry the same
          // identity and return the original transaction's result without another write.
          if(attempt<2){await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));continue;}
          const receipt = await ctx.runQuery(internal.toolWrites.receipt, { ...this.run, writeId }).catch(() => null);
          if (receipt) { this.record(receipt); execution.responseLost = true; }
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
        if (behavior.effect === 'read' || behavior.effect === 'analysis') throw error;
        output = { success: false, error: message(error) };
      }
      if (behavior.effect === 'read' || behavior.effect === 'analysis') return output;
      if (execution.receipt?.kind === 'timeline' && execution.receipt.status === 'saved' && (execution.responseLost||execution.receipt.revision > revision())) await reconcile();
      if (execution.responseLost && execution.receipt) output = { recovered: true, note: 'The write committed. Its response was interrupted; inspect the saved state before continuing.' };
      const kind = behavior.effect;
      const receipt: ToolSaveReceipt = execution.receipt
        ?? (execution.writeFailed ? { kind, status: 'failed', revision: revision(), message: execution.writeFailed }
          : execution.interrupted ? { kind, status: 'interrupted', revision: revision(), message: execution.interrupted }
            : { kind, status: 'unchanged', revision: revision() });
      return this.stamp(output, receipt);
    });
    if(behavior.effect!=='read'&&behavior.effect!=='analysis')this.completed.set(key,pending);
    try {
      const result=await pending;
      if(result&&typeof result==='object'&&'success' in result&&result.success===false)this.completed.delete(key);
      return result;
    } catch(error) {this.completed.delete(key);throw error;}
  }
}
