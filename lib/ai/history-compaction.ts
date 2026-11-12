import type { ModelMessage } from 'ai';

/** What the server recorded when an earlier request of this chat ended (assistant:earlierRequests). */
export type EarlierRequestRecord = {
  /** The request's text, to pair the record with its message. */
  text: string;
  /** Null when the request has no turn record (an older or non-editor message). */
  turn: EarlierTurn | null;
};
type EarlierTurn = {
  status: 'running' | 'completed' | 'failed' | 'stopped';
  savedEdits: number;
  /** The timeline revision when the request ended; absent on turns recorded before it was kept. */
  revision?: number;
  error?: string;
};

/**
 * The editor chat's earlier requests, as the model sees them on every step of the current request. Each
 * earlier request contributes three things: what the user asked, what the assistant answered, and one line
 * the server writes from the turn record (finished or not, saved revision, edit count, failure reason).
 * Tool calls and tool results of earlier requests are left out, including those of failed and stopped
 * requests: the current timeline and media in the system prompt are the truth, and an old result such as
 * `staged: true` can only be stale. The current request is not part of `history` and keeps its full tool
 * history. Earlier requests change only when a new request starts, so the cached prefix stays stable.
 */
const HISTORY_BUDGET = 40_000, MAX_ERROR = 300, MAX_ANSWER = 4000;

type Part = { type: string; text?: string; toolName?: string; input?: unknown };
/** A message's text parts. The server's record query uses it too, so a request and its record compare equal. */
export const textOf = (content: unknown) => typeof content === 'string' ? content : Array.isArray(content) ? (content as Part[]).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n') : '';
const attachments = (content: ModelMessage['content']) => typeof content === 'string' ? 0 : (content as Part[]).filter(part => part.type === 'image' || part.type === 'file').length;

/** Group history into requests: each starts at a user message and runs to the next one. */
function requests(messages: ModelMessage[]) {
  const groups: ModelMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }
  return groups;
}

function recordLine(record: EarlierTurn | null | undefined) {
  if (!record) return '[Server record of this request: none kept.]';
  const status = record.status === 'completed' ? 'finished' : record.status === 'stopped' ? 'stopped by the user' : record.status === 'failed' ? 'failed' : 'did not finish';
  const error = record.error ? `; reason: ${record.error.length > MAX_ERROR ? `${record.error.slice(0, MAX_ERROR)}…` : record.error}` : '';
  const revision = record.revision === undefined ? '' : `; timeline at revision ${record.revision}`;
  return `[Server record of this request: ${status}${revision}; ${record.savedEdits} edit${record.savedEdits === 1 ? '' : 's'} saved${error}.]`;
}

/** Pair each request with its record, newest first, by its text. Records cover every earlier prompt (with
 * `turn: null` where none was kept), so a request never takes an older request's record of the same text. */
function pairRecords(groups: ModelMessage[][], records: EarlierRequestRecord[]) {
  const paired = new Map<number, EarlierTurn | null>();
  let next = records.length - 1;
  for (let index = groups.length - 1; index >= 0 && next >= 0; index--) {
    const text = textOf(groups[index][0].content).trim();
    for (let candidate = next; candidate >= 0; candidate--) {
      if (records[candidate].text.trim() !== text) continue;
      paired.set(index, records[candidate].turn);
      next = candidate - 1;
      break;
    }
  }
  return paired;
}

/** A question asked with askUser lives only in its tool call: kept as text, so the user's answer still makes sense. */
function askedQuestions(message: ModelMessage) {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return (message.content as Part[]).filter(part => part.type === 'tool-call' && part.toolName === 'askUser').map(part => {
    const input = (part.input ?? {}) as { question?: unknown; options?: { label?: unknown }[] };
    const options = Array.isArray(input.options) ? input.options.map(option => String(option?.label ?? '')).filter(Boolean) : [];
    return `[Asked the user: ${String(input.question ?? '')}${options.length ? ` Options: ${options.join(' | ')}` : ''}]`;
  }).join('\n');
}

function compactRequest(group: ModelMessage[], record: EarlierTurn | null | undefined): ModelMessage[] {
  const asked = textOf(group[0].content), attached = attachments(group[0].content);
  const user = [asked, attached ? `[${attached} attachment${attached === 1 ? '' : 's'} omitted.]` : '', recordLine(record)].filter(Boolean).join('\n\n');
  // Every assistant text of the request, so a later server message (Stop, a failure) does not replace the reply.
  const said = group.filter(message => message.role === 'assistant').map(message => [textOf(message.content).trim(), askedQuestions(message)].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
  const answer = said.length > MAX_ANSWER ? `…${said.slice(-MAX_ANSWER)}` : said;
  return [{ role: 'user', content: user }, ...(answer ? [{ role: 'assistant' as const, content: answer }] : [])];
}

export function compactEditorHistory(history: ModelMessage[], records: EarlierRequestRecord[] = []): ModelMessage[] {
  // A window that starts inside a request has lost what was asked: that request is left out.
  const groups = requests(history).filter(group => group[0].role === 'user');
  const paired = pairRecords(groups, records);
  const compacted = groups.map((group, index) => compactRequest(group, paired.get(index)));
  // Over budget: keep the newest requests that fit, and say that older ones were left out.
  let total = 0, keep = compacted.length;
  for (let index = compacted.length - 1; index >= 0; index--) {
    total += compacted[index].reduce((sum, message) => sum + textOf(message.content).length, 0);
    if (total > HISTORY_BUDGET && index < compacted.length - 1) { keep = compacted.length - 1 - index; break; }
  }
  const kept = compacted.slice(compacted.length - keep).flat();
  return keep < compacted.length ? [{ role: 'user', content: `[${compacted.length - keep} earlier requests of this conversation were left out to save context. The latest user request wins.]` }, ...kept] : kept;
}
