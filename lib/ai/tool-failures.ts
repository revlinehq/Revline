import { isOverlapPlacementRejection } from '../editor/timeline-edit-errors';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

type ToolSteps = readonly { content: readonly unknown[] }[];
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const outputValue = (value: unknown) => { const output = record(value); return output.type === 'json' ? record(output.value) : output; };

/** A correction may alter only the time delta, retaining the exact selected
 * target set and layer movement. Other commands keep exact-input identity. */
function placementTarget(toolName: string | undefined, input: unknown) {
  const args = record(input);
  if (toolName !== 'moveClips' || !Array.isArray(args.clipIds) || !args.clipIds.length || args.clipIds.some(id => typeof id !== 'string' || !id) || new Set(args.clipIds).size !== args.clipIds.length || typeof args.timeDelta !== 'number' || !Number.isFinite(args.timeDelta) || (args.layerDelta !== undefined && (typeof args.layerDelta !== 'number' || !Number.isInteger(args.layerDelta)))) return undefined;
  return stable({ clipIds: [...args.clipIds].sort(), layerDelta: args.layerDelta ?? 0 });
}
function changedTargets(input: unknown, output: Record<string, unknown>) {
  const args = record(input);
  return (output.staged === true || output.saved === true) && Array.isArray(args.clipIds) && Array.isArray(output.changedClips) && args.clipIds.every(id => (output.changedClips as unknown[]).some(clip => record(clip).id === id));
}
function inspectedDraft(output: Record<string, unknown>) {
  const summary = record(output.summary);
  return typeof output.staged === 'boolean' && Number.isInteger(output.revision) && summary.overlapCount === 0 && Array.isArray(summary.missingAssetRefs) && summary.missingAssetRefs.length === 0;
}
function planTarget(toolName:string|undefined,input:unknown){
  const plans=record(input).plans;
  if(toolName!=='planEffects'||!Array.isArray(plans)||!plans.length)return;
  const identity=plans.map(record).map(plan=>({id:plan.id,kind:plan.kind,effect:plan.effect}));
  if(identity.some(plan=>typeof plan.id!=='string'||typeof plan.kind!=='string'||typeof plan.effect!=='string'))return;
  return stable(identity.sort((a,b)=>String(a.id).localeCompare(String(b.id))));
}
const planPreflightRejection=(error:unknown)=>/^(?:Error:\s*)?(?:Read the current (?:cut|marker) before planning its effect|Plan a supported effect or text control|Plan needs valid fields and a supported effect or text control)\.$/.test(error instanceof Error?error.message:String(error));
function zoomTarget(toolName:string|undefined,input:unknown){
  if(toolName!=='configureSmoothZoom'&&toolName!=='configureCameraMotion')return;
  const {replaceMotion,...settings}=record(input);
  if(typeof settings.clipId!=='string')return;
  return stable({toolName,...settings});
}
const zoomMotionRejection=(error:unknown)=>/^(?:Error:\s*)?This clip already has custom motion\. Explicitly replace its motion to add a (?:smooth zoom|camera glide)\.$/.test(error instanceof Error?error.message:String(error));
function zoomEvidenceTarget(toolName:string|undefined,input:unknown){
  const args=record(input);
  if(typeof args.clipId!=='string')return;
  const {replaceMotion,...settings}=args;
  if(toolName==='configureSmoothZoom'&&record(args.focus).kind==='target')return stable({toolName,...settings,focus:{kind:'target'}});
  if(toolName==='configureCameraMotion'&&Array.isArray(args.keyframes)&&args.keyframes.some(key=>record(record(key).focus).kind==='target'))return stable({toolName,...settings,keyframes:args.keyframes.map(key=>{const point=record(key);return record(point.focus).kind==='target'?{...point,focus:{kind:'target'}}:point;})});
}
const zoomEvidenceRejection=(error:unknown)=>/^(?:Error:\s*)?(?:Inspect the target during this zoom window, not a different moment\.|Inspect the moving target at this keyframe source time\. A position from another moment cannot verify cursor or object following\.)$/.test(error instanceof Error?error.message:String(error));

/** Derive state from completed steps: the SDK can reevaluate a stop condition. */
function unresolvedFailures(steps: ToolSteps, recoverPlacements = false) {
  const calls = new Map<string, { key: string; input: unknown }>(), pending = new Map<string, { count: number; ids: string[]; placement?: string; plan?:boolean; zoom?:string; zoomEvidence?:string; corrected?: boolean }>();
  for (const step of steps) for (const value of step.content) {
    if (!value || typeof value !== 'object') continue;
    const part = value as { type?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; error?: unknown; preliminary?: boolean };
    if (part.preliminary) continue;
    const id = part.toolCallId ?? '';
    const input = part.input ?? calls.get(id)?.input;
    const key = input !== undefined ? `${part.toolName}:${stable(input)}` : calls.get(id)?.key ?? `${part.toolName}:${id}`;
    const output = outputValue(part.output);
    if (part.type === 'tool-call') calls.set(id, { key, input });
    else if (part.type === 'tool-error' || (part.type === 'tool-result' && (output.success === false || record(part.output).type === 'error-text'))) {
      const failure=part.error??record(part.output).value;
      pending.set(key, { count: (pending.get(key)?.count ?? 0) + 1, ids: [...pending.get(key)?.ids ?? [], id], ...(recoverPlacements && isOverlapPlacementRejection(part.error) ? { placement: placementTarget(part.toolName, input) } : {}),...(recoverPlacements&&part.toolName==='planEffects'&&planPreflightRejection(failure)?{plan:true}:{}),...(recoverPlacements&&zoomMotionRejection(failure)?{zoom:zoomTarget(part.toolName,input)}:{}),...(recoverPlacements&&zoomEvidenceRejection(failure)?{zoomEvidence:zoomEvidenceTarget(part.toolName,input)}:{}) });
    } else if (part.type === 'tool-result') {
      pending.delete(key);
      if (recoverPlacements) {
        const plan=planTarget(part.toolName,input);
        // savePlan replaces the run's entire previous plan collection. Only its
        // validated receipt supersedes earlier no-write schema/anchor attempts.
        if(plan&&output.planned===true&&planTarget(part.toolName,{plans:output.plans})===plan)for(const [failedKey,failure]of pending)if(failure.plan)pending.delete(failedKey);
        const zoom=zoomTarget(part.toolName,input),args=record(input);
        if(zoom&&args.replaceMotion===true&&(output.saved===true||output.staged===true)&&Array.isArray(output.changedClips)&&output.changedClips.some(clip=>record(clip).id===args.clipId))for(const [failedKey,failure]of pending)if(failure.zoom===zoom)pending.delete(failedKey);
        const evidence=zoomEvidenceTarget(part.toolName,input);
        // A newer inspected target may correct a no-write timestamp rejection.
        // Require the same clip and zoom settings plus a real saved/staged
        // change; a successful analysis or another clip cannot clear it.
        if(evidence&&(output.saved===true||output.staged===true)&&Array.isArray(output.changedClips)&&output.changedClips.some(clip=>record(clip).id===args.clipId))for(const [failedKey,failure]of pending)if(failure.zoomEvidence===evidence)pending.delete(failedKey);
        const target = placementTarget(part.toolName, input);
        if (target && changedTargets(input, output)) for (const failure of pending.values()) if (failure.placement === target) failure.corrected = true;
        if (part.toolName === 'inspectTimeline' && inspectedDraft(output)) for (const [failedKey, failure] of pending) if (failure.corrected) pending.delete(failedKey);
      }
    }
  }
  return pending;
}

/** Exact retries resolve errors. A typed no-write placement rejection also
 * resolves after a successful same-target correction and clean draft inspection. */
export function hasUnresolvedToolFailures(steps: ToolSteps) {
  return unresolvedFailures(steps, true).size > 0;
}

/** Presentation uses the same exact-retry accounting as the agent guard. */
export function unresolvedToolFailureIds(steps: ToolSteps) {
  return new Set([...unresolvedFailures(steps, true).values()].flatMap(failure => failure.ids));
}

export function hasRepeatedToolFailures(steps: ToolSteps) {
  return [...unresolvedFailures(steps).values()].some(failure => failure.count >= 3);
}

/** A corrected tool call must not hide a real failure in the final render check. */
export function hasFailedRenderChecks(steps:ToolSteps){
  const latest=new Map<string,string>();
  for(const step of steps)for(const value of step.content){
    const part=record(value),output=outputValue(part.output);
    if(part.type!=='tool-result'||part.toolName!=='previewRender'||part.preliminary||output.reviewed!==true||output.stale===true||output.revision!==output.currentRevision||!Array.isArray(output.observations))continue;
    for(const observation of output.observations){const item=record(observation);if(typeof item.planId==='string'&&typeof item.verdict==='string')latest.set(item.planId,item.verdict);}
  }
  return [...latest.values()].some(verdict=>verdict==='fail');
}

export class AssistantRenderReviewError extends Error {
  constructor(){super('The saved edit did not pass the final visual check. Some requested changes remain unfinished.');this.name='AssistantRenderReviewError';}
}

export class AssistantToolRetryError extends Error {
  constructor() {
    super('Stopped after the same tool command failed three times. Previously saved edits remain; inspect the current timeline before continuing.');
    this.name = 'AssistantToolRetryError';
  }
}
