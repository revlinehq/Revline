function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

/** A successful retry of the same command resolves its earlier tool error. */
export function hasUnresolvedToolFailures(steps: readonly { content: readonly unknown[] }[]) {
  const calls = new Map<string, string>(), pending = new Set<string>();
  for (const step of steps) for (const value of step.content) {
    const part = value as { type?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown };
    const id = part.toolCallId ?? '';
    const key = part.input !== undefined ? `${part.toolName}:${stable(part.input)}` : calls.get(id) ?? `${part.toolName}:${id}`;
    if (part.type === 'tool-call') calls.set(id, key);
    else if (part.type === 'tool-error' || (part.type === 'tool-result' && (part.output as { success?: boolean } | undefined)?.success === false)) pending.add(key);
    else if (part.type === 'tool-result') pending.delete(key);
  }
  return pending.size > 0;
}
