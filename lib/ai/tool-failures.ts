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

/** Derive state from completed steps: the SDK can reevaluate a stop condition. */
function unresolvedFailures(steps: ToolSteps, recoverPlacements = false) {
  const calls = new Map<string, { key: string; input: unknown }>(), pending = new Map<string, { count: number; placement?: string; corrected?: boolean }>();
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
      pending.set(key, { count: (pending.get(key)?.count ?? 0) + 1, ...(recoverPlacements && isOverlapPlacementRejection(part.error) ? { placement: placementTarget(part.toolName, input) } : {}) });
    } else if (part.type === 'tool-result') {
      pending.delete(key);
      if (recoverPlacements) {
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

export function hasRepeatedToolFailures(steps: ToolSteps) {
  return [...unresolvedFailures(steps).values()].some(failure => failure.count >= 3);
}

export class AssistantToolRetryError extends Error {
  constructor() {
    super('Stopped after the same tool command failed three times. Previously saved edits remain; inspect the current timeline before continuing.');
    this.name = 'AssistantToolRetryError';
  }
}
