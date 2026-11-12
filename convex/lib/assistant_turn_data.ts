import { tablePatch } from './exact';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** Chat observes visible status, never continuation prompts or frame-review bookkeeping. */
export async function syncTurnView(ctx: MutationCtx, turn: Doc<'assistantTurns'>) {
  const row = await ctx.db.query('assistantTurnViews').withIndex('by_prompt', q => q.eq('projectId', turn.projectId).eq('promptMessageId', turn.promptMessageId)).unique();
  const value = { projectId: turn.projectId, promptMessageId: turn.promptMessageId, runId: turn.runId, turnId:turn._id,segment:turn.segment,status: turn.status, error: turn.error, resuming: turn.status === 'running' && (turn.pass > 0 || !!turn.args.continuation) };
  if (!row) await ctx.db.insert('assistantTurnViews', value);
  // A new run of the same request (Retry) has not said what it runs on yet: drop the previous run's model.
  else if (row.runId !== value.runId) await ctx.db.patch(row._id, tablePatch<'assistantTurnViews'>()({ ...value, model: undefined, effort: undefined }));
  else if (row.segment!==value.segment || row.status !== value.status || row.error !== value.error || row.resuming !== value.resuming) await ctx.db.patch(row._id, value);
}
export async function patchTurn(ctx: MutationCtx, turn: Doc<'assistantTurns'>, patch: Partial<Omit<Doc<'assistantTurns'>, '_id' | '_creationTime'>>) {
  await ctx.db.patch(turn._id, patch);
  if (['runId', 'status', 'error', 'pass', 'args', 'segment'].some(key => Object.hasOwn(patch, key))) await syncTurnView(ctx, { ...turn, ...patch });
}

/** A terminal callback only needs the segment and status, never the saved turn arguments. */
export async function turnSummaryForRun(ctx:QueryCtx|MutationCtx,runId:string){
  const view=await ctx.db.query('assistantTurnViews').withIndex('by_run',q=>q.eq('runId',runId)).unique();
  if(view)return {...view,legacy:null};
  const legacy=await ctx.db.query('assistantTurns').withIndex('by_run',q=>q.eq('runId',runId)).unique();
  return legacy?{...legacy,turnId:legacy._id,legacy}:null;
}
export async function settleTurn(ctx:MutationCtx,turn:NonNullable<Awaited<ReturnType<typeof turnSummaryForRun>>>,patch:{status:'failed'|'completed';error?:string;revision?:number}){
  if(turn.legacy){await patchTurn(ctx,turn.legacy,{...patch,updatedAt:Date.now()});return;}
  await ctx.db.patch(turn.turnId,tablePatch<'assistantTurns'>()({...patch,updatedAt:Date.now()}));
  await ctx.db.patch(turn._id,tablePatch<'assistantTurnViews'>()({status:patch.status,error:patch.error,resuming:false}));
}
