import { parse } from 'convex-helpers/validators';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { vMessageDoc, vMessageWithMetadata, vMessageEmbeddingsWithDimension } from '@convex-dev/agent/validators';
import type { MessageDoc } from '@convex-dev/agent';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { components, internal } from './_generated/api';
import { displayMessage, inlineFile, saveMessageView } from './lib/chat_data';

const addArgs = {
  threadId: v.string(), userId: v.optional(v.string()), promptMessageId: v.optional(v.string()), abandonIfPromptMissing: v.optional(v.boolean()),
  order: v.optional(v.union(v.number(), v.literal('next'))), agentName: v.optional(v.string()), messages: v.array(vMessageWithMetadata),
  embeddings: v.optional(vMessageEmbeddingsWithDimension), failPendingSteps: v.optional(v.boolean()), pendingMessageId: v.optional(v.string()), hideFromUserIdSearch: v.optional(v.boolean()), finishStreamId: v.optional(v.string()),
};

async function refreshPending(ctx: MutationCtx, threadId: string) {
  const pending = await ctx.db.query('assistantMessageViews').withIndex('by_thread_status', q => q.eq('threadId', threadId).eq('status', 'pending')).collect();
  if (!pending.length) return;
  const docs = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: pending.map(row => row.messageId) });
  for (const doc of docs) if (doc) await saveMessageView(ctx, doc);
}

export const add = internalMutation({ args: addArgs, returns: v.object({ messages: v.array(vMessageDoc) }), handler: async (ctx, args): Promise<{ messages: MessageDoc[] }> => {
  const result = await ctx.runMutation(components.agent.messages.addMessages, args);
  if (args.failPendingSteps !== false) await refreshPending(ctx, args.threadId);
  for (const message of result.messages) await saveMessageView(ctx, message);
  return result;
}});

export const finalize = internalMutation({ args: { messageId: v.string(), result: v.union(v.object({ status: v.literal('success') }), v.object({ status: v.literal('failed'), error: v.string() })) }, returns: v.null(), handler: async (ctx, args) => {
  await ctx.runMutation(components.agent.messages.finalizeMessage, args);
  const [doc] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [args.messageId] });
  if (doc) {
    await saveMessageView(ctx, doc);
    // Cancellation can materialize extra messages. Reconcile only this stream's steps, one document per page.
    await ctx.scheduler.runAfter(0, internal.assistantMessages.recover, { threadId: doc.threadId, messageId: doc._id, order: doc.order, stepOrder: doc.stepOrder, cursor: null });
  }
  return null;
}});

export const recover = internalMutation({ args: { threadId: v.string(), messageId: v.string(), order: v.number(), stepOrder: v.number(), cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, { threadId: args.threadId, order: 'desc', upToAndIncludingMessageId: args.messageId, paginationOpts: { cursor: args.cursor, numItems: 1 } });
  for (const doc of page.page) {
    if (doc.order !== args.order || doc.stepOrder < args.stepOrder) return null;
    await saveMessageView(ctx, doc);
  }
  if (!page.isDone && page.page.length) await ctx.scheduler.runAfter(0, internal.assistantMessages.recover, { ...args, cursor: page.continueCursor });
  return null;
}});

/** The SDK can finalize a disconnected stream inside its component, without calling our write gateway. */
export const reconcilePending = internalMutation({ args: { messageId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const view = await ctx.db.query('assistantMessageViews').withIndex('by_message', q => q.eq('messageId', args.messageId)).unique();
  if (!view || view.status !== 'pending') return null;
  const [doc] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [args.messageId] });
  if (!doc) { await ctx.db.delete(view._id); return null; }
  if (JSON.stringify(displayMessage(doc)) !== JSON.stringify(view.value)) await saveMessageView(ctx, doc);
  if (doc.status === 'pending') await ctx.scheduler.runAfter(30_000, internal.assistantMessages.reconcilePending, args);
  else await ctx.scheduler.runAfter(0, internal.assistantMessages.recover, { threadId: doc.threadId, messageId: doc._id, order: doc.order, stepOrder: doc.stepOrder, cursor: null });
  return null;
}});

const { message, fileIds, status, error, model, provider, providerOptions, finishReason } = vMessageDoc.fields;
export const update = internalMutation({ args: { messageId: v.string(), patch: v.object({ message, fileIds, status: v.optional(status), error, model, provider, providerOptions, finishReason }) }, returns: vMessageDoc, handler: async (ctx, args): Promise<MessageDoc> => {
  const doc = await ctx.runMutation(components.agent.messages.updateMessage, args);
  await saveMessageView(ctx, doc);
  return doc;
}});

/** Existing threads keep their old query until every display row has been backfilled. */
export const prepare = internalMutation({ args: { threadId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.query('assistantMessageThreads').withIndex('by_thread', q => q.eq('threadId', args.threadId)).unique();
  if (!row) await ctx.db.insert('assistantMessageThreads', { threadId: args.threadId, cursor: null, completed: false });
  if (!row?.completed) await ctx.scheduler.runAfter(0, internal.assistantMessages.backfill, { threadId: args.threadId, cursor: row?.cursor ?? null });
  return null;
}});

// Legacy inline images need real file URLs before their display copy is written.
async function moveImages(value: unknown, store: (data: string | ArrayBuffer, mediaType: string) => Promise<string>): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => moveImages(item, store)));
  if (!value || typeof value !== 'object') return value;
  if (inlineFile(value)) {
    const mediaType = 'mediaType' in value && typeof value.mediaType === 'string' ? value.mediaType : 'image/jpeg';
    return { ...value, data: { type: 'url', url: await store(value.data.data, mediaType) } };
  }
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await moveImages(item, store)])));
}

export const backfill = internalAction({ args: { threadId: v.string(), cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const page = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, { threadId: args.threadId, order: 'desc', paginationOpts: { cursor: args.cursor, numItems: 1 } });
  const storageIds: Id<'_storage'>[] = [];
  try {
    for (const message of page.page) {
      const value = await moveImages(message, async (data, mediaType) => {
        const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : data;
        const id = await ctx.storage.store(new Blob([bytes], { type: mediaType }));
        storageIds.push(id);
        return (await ctx.storage.getUrl(id))!;
      });
      await ctx.runMutation(internal.assistantMessages.backfillPage, { threadId: args.threadId, message: parse(vMessageDoc, value), storageIds, sourceCursor: args.cursor, cursor: page.continueCursor, completed: page.isDone });
    }
    if (!page.page.length) await ctx.runMutation(internal.assistantMessages.backfillPage, { threadId: args.threadId, storageIds: [], sourceCursor: args.cursor, cursor: page.continueCursor, completed: true });
  } catch (error) { for (const id of storageIds) await ctx.storage.delete(id); throw error; }
  return null;
}});
export const backfillPage = internalMutation({ args: { threadId: v.string(), message: v.optional(vMessageDoc), storageIds: v.array(v.id('_storage')), sourceCursor: v.union(v.string(), v.null()), cursor: v.string(), completed: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  const state = await ctx.db.query('assistantMessageThreads').withIndex('by_thread', q => q.eq('threadId', args.threadId)).unique();
  if (!state || state.completed || state.cursor !== args.sourceCursor) { for (const id of args.storageIds) await ctx.storage.delete(id); return null; }
  if (args.message) {
    const existing = await ctx.db.query('assistantMessageViews').withIndex('by_message', q => q.eq('messageId', args.message!._id)).unique();
    if (existing) { for (const id of args.storageIds) await ctx.storage.delete(id); }
    else {
      await saveMessageView(ctx, args.message, true);
      if (args.storageIds.length) await ctx.db.insert('assistantDisplayFiles', { threadId: args.threadId, storageIds: args.storageIds });
    }
  }
  await ctx.db.patch(state._id, { cursor: args.cursor, completed: args.completed });
  if (!args.completed) await ctx.scheduler.runAfter(0, internal.assistantMessages.backfill, { threadId: args.threadId, cursor: args.cursor });
  return null;
}});

export const imageSource = internalQuery({ args: { messageId: v.string(), version: v.number() }, handler: async (ctx, args) => {
  const view = await ctx.db.query('assistantMessageViews').withIndex('by_message', q => q.eq('messageId', args.messageId)).unique();
  if (!view || view.version !== args.version) return null;
  const [doc] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [args.messageId] });
  return doc;
}});
export const externalize = internalAction({ args: { messageId: v.string(), version: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const doc = await ctx.runQuery(internal.assistantMessages.imageSource, args);
  if (!doc) return null;
  const storageIds: Id<'_storage'>[] = [];
  try {
    const value = await moveImages(doc, async (data, mediaType) => {
      const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : data;
      const id = await ctx.storage.store(new Blob([bytes], { type: mediaType }));
      storageIds.push(id);
      return (await ctx.storage.getUrl(id))!;
    });
    await ctx.runMutation(internal.assistantMessages.saveImages, { ...args, message: parse(vMessageDoc, value), storageIds });
  } catch (error) { for (const id of storageIds) await ctx.storage.delete(id); throw error; }
  return null;
}});
export const saveImages = internalMutation({ args: { messageId: v.string(), version: v.number(), message: vMessageDoc, storageIds: v.array(v.id('_storage')) }, returns: v.null(), handler: async (ctx, args) => {
  const view = await ctx.db.query('assistantMessageViews').withIndex('by_message', q => q.eq('messageId', args.messageId)).unique();
  if (!view || view.version !== args.version) { for (const id of args.storageIds) await ctx.storage.delete(id); return null; }
  await saveMessageView(ctx, args.message);
  if (args.storageIds.length) await ctx.db.insert('assistantDisplayFiles', { threadId: args.message.threadId, storageIds: args.storageIds });
  return null;
}});
