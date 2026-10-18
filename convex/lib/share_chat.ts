import { listMessages, type MessageDoc } from '@convex-dev/agent';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { SHARED_CHAT_LIMITS, type ShareChatPreview, type ShareChatPreviewMessage, type SharedChatMessage } from '../../lib/editor/shared-chat';

type Context = QueryCtx | MutationCtx;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const receipt = (value: unknown) => !!object(object(value).revline).publicationReceipt;
const failureText = /^(?:No timeline changes were saved\.|\d+ edits were saved before the assistant stopped\.|Your pending replacement was (?:not saved|cancelled)\.)|(?:could not|couldn’t|couldn't) finish this step|(?:analysis|visual check|speech.analysis|request) timed out|this request reached its token budget/i;

/** Deliberate allowlist: SDK reasoning, tools, attachments, errors and metadata
 * never enter the public snapshot. Links are redacted in the owner preview too. */
function publicMessage(row: MessageDoc, ownerId: string): ShareChatPreviewMessage | null {
  const message = row.message;
  if (row.status !== 'success' || row.error || row.tool || (row.userId !== undefined && row.userId !== ownerId) || !message || (message.role !== 'user' && message.role !== 'assistant') || receipt(row.providerMetadata)) return null;
  const text = (typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' && !receipt(part.providerMetadata) ? [part.text] : []).join('\n\n')).trim();
  if (!text || (message.role === 'assistant' && failureText.test(text))) return null;
  const redacted = text.replace(/\b(?:https?:\/\/|file:\/\/|data:)[^\s<>()]+/gi, '[link removed]');
  return { id: row._id, role: message.role, text: redacted.length > SHARED_CHAT_LIMITS.messageCharacters ? `${redacted.slice(0, SHARED_CHAT_LIMITS.messageCharacters - 1)}…` : redacted };
}

async function requireThread(ctx: Context, project: Doc<'projects'>) {
  if (!project.threadId) return null;
  const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId: project.threadId });
  if (!thread || thread.userId !== project.ownerId) throw new ConvexError('Conversation not found.');
  return project.threadId;
}

export async function previewSharedChat(ctx: Context, project: Doc<'projects'>): Promise<ShareChatPreview> {
  const threadId = await requireThread(ctx, project);
  if (!threadId) return { messages: [], truncated: false };
  const page = await listMessages(ctx, components.agent, { threadId, excludeToolMessages: true, statuses: ['success'], paginationOpts: { cursor: null, numItems: SHARED_CHAT_LIMITS.scanned, maximumBytesRead: 500_000 } });
  const messages: ShareChatPreviewMessage[] = [];
  let characters = 0, truncated = !page.isDone;
  for (const row of page.page) {
    const message = publicMessage(row, project.ownerId);
    if (!message) continue;
    if (messages.length >= SHARED_CHAT_LIMITS.messages || characters + message.text.length > SHARED_CHAT_LIMITS.characters) { truncated = true; break; }
    messages.push(message); characters += message.text.length;
    if (message.text.endsWith('…')) truncated = true;
  }
  return { messages: messages.reverse(), truncated };
}

/** Re-read exactly the records the owner previewed. A stale/foreign selection
 * fails atomically rather than publishing different or partially matched text. */
export async function snapshotSharedChat(ctx: MutationCtx, project: Doc<'projects'>, selected: ShareChatPreviewMessage[]): Promise<SharedChatMessage[]> {
  if (selected.length > SHARED_CHAT_LIMITS.messages || new Set(selected.map(message => message.id)).size !== selected.length || selected.some(message => !message.id || message.text.length > SHARED_CHAT_LIMITS.messageCharacters) || selected.reduce((total, message) => total + message.text.length, 0) > SHARED_CHAT_LIMITS.characters) throw new ConvexError('Chat preview is too large. Reload the sharing dialog.');
  if (!selected.length) return [];
  const threadId = await requireThread(ctx, project);
  if (!threadId) throw new ConvexError('Conversation not found.');
  const rows = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: selected.map(message => message.id) });
  const byId = new Map(rows.flatMap(row => row ? [[row._id, row] as const] : []));
  const snapshots = selected.map(expected => {
    const row = byId.get(expected.id), message = row?.threadId === threadId ? publicMessage(row, project.ownerId) : null;
    if (!row || !message || message.role !== expected.role || message.text !== expected.text) throw new ConvexError('Chat preview changed. Reload the sharing dialog before publishing.');
    return { row, message };
  });
  return snapshots.sort((a, b) => a.row.order - b.row.order || a.row.stepOrder - b.row.stepOrder).map(({ message: { role, text } }) => ({ role, text }));
}
