function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

type ToolSteps = readonly { content: readonly unknown[] }[];

/** Derive state from completed steps: the SDK can reevaluate a stop condition. */
function unresolvedFailures(steps: ToolSteps) {
  const calls = new Map<string, string>(), pending = new Map<string, number>();
  for (const step of steps) for (const value of step.content) {
    if (!value || typeof value !== 'object') continue;
    const part = value as { type?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; preliminary?: boolean };
    if (part.preliminary) continue;
    const id = part.toolCallId ?? '';
    const key = part.input !== undefined ? `${part.toolName}:${stable(part.input)}` : calls.get(id) ?? `${part.toolName}:${id}`;
    if (part.type === 'tool-call') calls.set(id, key);
    else if (part.type === 'tool-error' || (part.type === 'tool-result' && (part.output as { success?: boolean } | undefined)?.success === false)) pending.set(key, (pending.get(key) ?? 0) + 1);
    else if (part.type === 'tool-result') pending.delete(key);
  }
  return pending;
}

/** A successful retry of the same command resolves its earlier tool error. */
export function hasUnresolvedToolFailures(steps: ToolSteps) {
  return unresolvedFailures(steps).size > 0;
}

export function hasRepeatedToolFailures(steps: ToolSteps) {
  return [...unresolvedFailures(steps).values()].some(count => count >= 3);
}

export class AssistantToolRetryError extends Error {
  constructor() {
    super('Stopped after the same tool command failed three times. Previously saved edits remain; inspect the current timeline before continuing.');
    this.name = 'AssistantToolRetryError';
  }
}
