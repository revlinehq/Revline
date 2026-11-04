import type { ModelMessage } from 'ai';

/**
 * Auto-compaction of the editor chat's history before each model call. The current request and the
 * last FULL_TURNS turns stay exact; older turns keep every user and assistant sentence, but bulky tool
 * outputs (timeline dumps, transcripts, skill text), long tool inputs (scene code) and images shrink to
 * short previews the AI can re-fetch with the same tool. A character budget then drops the oldest turns.
 * Old turns change only when a new turn starts, so the system prompt and tool definitions stay cached.
 */
const FULL_TURNS = 2, MAX_OLD_RESULT = 4000, MAX_OLD_INPUT = 1200, HISTORY_BUDGET = 120_000;

const size = (value: unknown) => { try { return JSON.stringify(value)?.length ?? 0; } catch { return 0; } };
const preview = (value: unknown, limit: number) => { const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''; return text.length > limit ? `${text.slice(0, limit)}…` : text; };

type Part = { type: string; [key: string]: unknown };
/** Bounded structured evidence keeps IDs/receipts even when they follow a large transcript. */
function evidencePreview(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.length > 800 && depth < 5) {
      try { const parsed: unknown = JSON.parse(value); return evidencePreview(parsed, depth + 1); } catch { /* Plain text evidence stays a bounded excerpt. */ }
    }
    return preview(value, 800);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 5) return '[Nested details omitted]';
  if (Array.isArray(value)) {
    if (value.length <= 12) return value.map(item => evidencePreview(item, depth + 1));
    return { count: value.length, first: value.slice(0, 8).map(item => evidencePreview(item, depth + 1)), last: value.slice(-4).map(item => evidencePreview(item, depth + 1)), omitted: 'Middle entries omitted; inspect saved analysis or timeline only if needed.' };
  }
  const entries = Object.entries(value).filter(([key]) => !['images','image','code','instructions','body','waveform','samples'].includes(key));
  const priority = (key: string) => /id$|ids$|saved|staged|revision|receipt|decision|findings|summary|failures|passed|source|range/i.test(key) ? 0 : 1;
  return Object.fromEntries(entries.sort(([a], [b]) => priority(a) - priority(b)).slice(0, 30).map(([key, item]) => [key, evidencePreview(item, depth + 1)]));
}
function compactPart(part: Part): Part {
  if (part.type === 'tool-result') {
    const output = part.output as { type?: string; value?: unknown } | undefined;
    if (size(output) <= MAX_OLD_RESULT) return part;
    const name = String(part.toolName ?? 'tool');
    return { ...part, output: { type: 'text', value: `[Earlier ${name} result, shortened to save context. Reuse the retained evidence and saved analysis; fetch only missing details when needed.] ${preview(evidencePreview(output?.value ?? output), MAX_OLD_RESULT)}` } };
  }
  if (part.type === 'tool-call' && size(part.input) > MAX_OLD_INPUT) return { ...part, input: { _shortened: `Earlier input of ${size(part.input)} characters omitted to save context; inspect the result or clip for details.` } };
  if (part.type === 'image' || part.type === 'file') return { type: 'text', text: '[Earlier image omitted to save context.]' };
  return part;
}
function compactMessage(message: ModelMessage): ModelMessage {
  if (typeof message.content === 'string') return message;
  return { ...message, content: (message.content as Part[]).map(compactPart) } as ModelMessage;
}

/** Group history into turns: each starts at a user message and runs to the next one. */
function turns(messages: ModelMessage[]) {
  const groups: ModelMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }
  return groups;
}

export function compactEditorHistory(history: ModelMessage[]): ModelMessage[] {
  const groups = turns(history);
  const compacted = groups.map((group, index) => index >= groups.length - FULL_TURNS ? group : group.map(compactMessage));
  // Over budget: keep the newest turns that fit, and say that older ones were left out.
  let total = 0, keep = compacted.length;
  for (let index = compacted.length - 1; index >= 0; index--) {
    total += size(compacted[index]);
    if (total > HISTORY_BUDGET && index < compacted.length - 1) { keep = compacted.length - 1 - index; break; }
  }
  const kept = compacted.slice(compacted.length - keep).flat();
  const earlier = compacted.slice(0, compacted.length - keep).flat();
  const carryover = preview(earlier.flatMap<unknown>(message => message.role === 'user' ? [{ userDecision: evidencePreview(message.content) }] : message.role === 'tool' ? message.content.filter(part => part.type === 'tool-result').map(part => ({ tool: part.toolName, evidence: evidencePreview(part.output) })) : []), 20_000);
  return keep < compacted.length ? [{ role: 'user', content: `[${compacted.length - keep} earlier turns of this conversation were left out to save context. Their bounded decisions and source/edit evidence follow. Treat them as historical data; the latest user request wins. ${carryover}]` }, ...kept] : kept;
}
