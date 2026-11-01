import { toUIMessages, type MessageDoc } from '@convex-dev/agent';
import type { PaginationOptions } from 'convex/server';
import { vMessageDoc } from '@convex-dev/agent/validators';
import { parse } from 'convex-helpers/validators';
import { components, internal } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const messageWrites = new Proxy(components.agent.messages, { get(target, name, receiver) {
  if (name === 'addMessages') return internal.assistantMessages.add;
  if (name === 'finalizeMessage') return internal.assistantMessages.finalize;
  if (name === 'updateMessage') return internal.assistantMessages.update;
  return Reflect.get(target, name, receiver);
} });
/** Component namespaces are proxies, not enumerable objects. Forward every other SDK reference unchanged. */
export const chatAgent: typeof components.agent = new Proxy(components.agent, { get(target, name, receiver) {
  return name === 'messages' ? messageWrites : Reflect.get(target, name, receiver);
} });

const codeKeys = new Set(['code', 'html', 'css', 'javascript', 'old', 'replacement', 'find', 'replace']);
export function inlineFile(value: unknown): value is { type: 'file'; data: { type: 'data'; data: string | ArrayBuffer } } {
  return !!value && typeof value === 'object' && 'type' in value && value.type === 'file' && 'data' in value && !!value.data && typeof value.data === 'object' && 'type' in value.data && value.data.type === 'data' && 'data' in value.data && (typeof value.data.data === 'string' || value.data.data instanceof ArrayBuffer);
}
function hasInlineFile(value: unknown): boolean {
  return inlineFile(value) || (Array.isArray(value) ? value.some(hasInlineFile) : !!value && typeof value === 'object' && Object.values(value).some(hasInlineFile));
}
function toolDisplay(value: unknown, key = ''): unknown {
  if (inlineFile(value)) return { ...value, data: { type: 'data', data: '' } };
  if (typeof value === 'string') {
    if (codeKeys.has(key)) return '';
    if (value.length <= 2048 || /^https:\/\//.test(value)) return value;
    try { return JSON.stringify(toolDisplay(JSON.parse(value))); } catch { return value.slice(0, 2048); }
  }
  if (Array.isArray(value)) return value.map(item => toolDisplay(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, toolDisplay(item, name)]));
  return value;
}

export function displayMessage(doc: MessageDoc): MessageDoc {
  const message = doc.message;
  const content = message && typeof message.content !== 'string' ? message.content.map(part => part.type === 'tool-call' || part.type === 'tool-result' ? toolDisplay(part) : part) : message?.content;
  return parse(vMessageDoc, { ...doc, providerOptions: undefined, usage: undefined, warnings: undefined, reasoningDetails: undefined,
    providerMetadata: doc.providerMetadata?.revline ? { revline: doc.providerMetadata.revline } : undefined,
    message: message ? { ...message, content } : undefined,
  });
}

export async function saveMessageView(ctx: MutationCtx, doc: MessageDoc, onlyMissing = false) {
  const row = await ctx.db.query('assistantMessageViews').withIndex('by_message', q => q.eq('messageId', doc._id)).unique();
  if (row && onlyMissing) return;
  const version = (row?.version ?? 0) + 1;
  const value = { messageId: doc._id, threadId: doc.threadId, order: doc.order, stepOrder: doc.stepOrder, status: doc.status, version, value: displayMessage(doc) };
  if (row) await ctx.db.patch(row._id, value);
  else await ctx.db.insert('assistantMessageViews', value);
  if (hasInlineFile(doc)) await ctx.scheduler.runAfter(0, internal.assistantMessages.externalize, { messageId: doc._id, version });
  if (doc.status === 'pending' && row?.status !== 'pending') await ctx.scheduler.runAfter(30_000, internal.assistantMessages.reconcilePending, { messageId: doc._id });
}

export async function createMessageHistory(ctx: MutationCtx, threadId: string) {
  await ctx.db.insert('assistantMessageThreads', { threadId, cursor: null, completed: true });
}

export async function listMessageViews(ctx: QueryCtx, threadId: string, paginationOpts: PaginationOptions) {
  const result = await ctx.db.query('assistantMessageViews').withIndex('by_thread_order', q => q.eq('threadId', threadId)).order('desc').paginate({ ...paginationOpts, cursor: paginationOpts.cursor?.slice('display:'.length) ?? null, endCursor: paginationOpts.endCursor?.slice('display:'.length) });
  return { ...result, continueCursor: `display:${result.continueCursor}`, ...(result.splitCursor ? { splitCursor: `display:${result.splitCursor}` } : {}), page: toUIMessages(result.page.map(row => row.value)) };
}
