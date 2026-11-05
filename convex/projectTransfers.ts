import { storeSceneCode } from './lib/scene_code';
import { chatAgent, createMessageHistory } from './lib/chat_data';
import { sharedAssetFields } from './lib/shared_media';
import { storedTimelineBytes } from '../lib/editor/scene-code';
import { createThread, saveMessages } from '@convex-dev/agent';
import { ConvexError, v, type Infer } from 'convex/values';
import { components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { analysisValidator, aspectRatio, assetFields, assetKind, previewFields, sharedChatMessage, timelineValidator, waveformValidator } from './schema';
import { shareAnalysis } from './lib/asset_analysis';
import { requireEditorAccess } from './lib/billing_access';
import { createProject, writeProject } from './lib/project_data';
import { enqueueMediaTask } from './lib/media_queue';
import { hasPreview } from './lib/media_storage';
import { recordAssetStorage } from './lib/storage_accounting';
import { HISTORY_BYTES, HISTORY_LIMIT, serializedBytes, validateTimeline } from './lib/timeline';

const ownerArgs = { ownerId: v.string(), email: v.string() };
const mediaValidator = v.object({
  ...previewFields, sourceId: v.string(), r2Key: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(), kind: assetKind,
  duration: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()),
  audioSourceId: v.optional(v.string()), audioExtracted: v.optional(v.boolean()), waveform: v.optional(waveformValidator),
  analysis: v.optional(analysisValidator), analysisUpdatedAt: v.optional(v.number()), analysisCompletedAt: assetFields.analysisCompletedAt,
  thumbnailStorageId: v.optional(v.id('_storage')),
});
const snapshotValidator = v.object({
  transferKey: v.string(), transferId: v.string(), sourceDeployment: v.string(), sourceProjectId: v.string(), sourceRevision: v.number(), fingerprint: v.string(),
  ...ownerArgs, title: v.string(), aspectRatio, timeline: timelineValidator, history: v.array(timelineValidator), media: v.array(mediaValidator),
  conversation: v.array(sharedChatMessage), publicChat: v.array(sharedChatMessage),
});
type Snapshot = Infer<typeof snapshotValidator>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function boundedString(value: string, label: string, limit: number) {
  if (!value.trim() || value.length > limit) throw new ConvexError(`Invalid ${label}`);
}
function finiteNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ConvexError('Transfer numbers must be finite');
  if (Array.isArray(value)) for (const item of value) finiteNumbers(item);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) finiteNumbers(item);
}
async function verifiedOwner(ctx: MutationCtx, ownerId: string, email: string) {
  boundedString(ownerId, 'target owner', 200); boundedString(email, 'target email', 320);
  const user = await ctx.db.query('users').withIndex('by_clerk_id', q => q.eq('clerkId', ownerId)).unique();
  if (!user?.email || user.email.trim().toLowerCase() !== email.trim().toLowerCase()) throw new ConvexError('Target account does not match the verified user email');
  await requireEditorAccess(ctx, ownerId);
}
function boundedChat(messages: Snapshot['conversation'], count: number, bytes: number) {
  if (messages.length > count || serializedBytes(messages) > bytes || messages.some(message => !message.text.trim() || serializedBytes(message.text) > 100_000)) throw new ConvexError('Transferred chat exceeds its text limits');
}
function validateSnapshot(args: Snapshot) {
  finiteNumbers(args);
  if (serializedBytes(args) > 4_000_000) throw new ConvexError('Transfer snapshot is too large');
  boundedString(args.transferKey, 'transfer key', 200); boundedString(args.sourceDeployment, 'source deployment', 100); boundedString(args.sourceProjectId, 'source project', 200); boundedString(args.title, 'project title', 200);
  if (!uuid.test(args.transferId) || !/^[a-f0-9]{64}$/i.test(args.fingerprint)) throw new ConvexError('Invalid transfer identity or fingerprint');
  if (!Number.isSafeInteger(args.sourceRevision) || args.sourceRevision < 0) throw new ConvexError('Invalid source revision');
  if (args.timeline.aspectRatio !== args.aspectRatio || !args.timeline.clips.length) throw new ConvexError('A shared transfer needs a nonempty timeline matching its project canvas');
  if (args.history.length > HISTORY_LIMIT || serializedBytes(args.history) > HISTORY_BYTES) throw new ConvexError('Transfer history exceeds its snapshot limits');
  if (args.media.length > 200) throw new ConvexError('A transfer supports up to 200 media sources');
  boundedChat(args.conversation, 1000, 1_000_000); boundedChat(args.publicChat, 200, 200_000);
  const ids = new Set<string>(), keys = new Set<string>(), prefix = `media/${args.ownerId}/${args.transferId}/`;
  for (const media of args.media) {
    boundedString(media.sourceId, 'source media ID', 200); boundedString(media.fileName, 'media filename', 500); boundedString(media.contentType, 'media content type', 200);
    if (ids.has(media.sourceId) || keys.has(media.r2Key)) throw new ConvexError('Transfer media IDs and object keys must be unique');
    ids.add(media.sourceId); keys.add(media.r2Key);
    if(media.previewR2Key){if(media.kind!=='video'||!hasPreview(media)||keys.has(media.previewR2Key)||!media.previewR2Key.startsWith(prefix)||!uuid.test(media.previewR2Key.slice(prefix.length)))throw new ConvexError('Transferred preview must use valid copied media in the target namespace');keys.add(media.previewR2Key);}else if(media.previewVersion!==undefined||media.previewSize!==undefined||media.previewWidth!==undefined||media.previewHeight!==undefined||media.previewFps!==undefined)throw new ConvexError('Transferred preview is incomplete');
    if (!media.r2Key.startsWith(prefix) || !uuid.test(media.r2Key.slice(prefix.length))) throw new ConvexError('Transferred media must use the target owner and transfer namespace');
    if (!Number.isSafeInteger(media.size) || media.size < 0 || media.size > 15_000_000_000) throw new ConvexError('Invalid transferred media size');
    if (media.duration !== undefined && media.duration < 0) throw new ConvexError('Invalid media duration');
    for (const dimension of [media.width, media.height]) if (dimension !== undefined && (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > 32768)) throw new ConvexError('Invalid media dimensions');
    if (media.waveform && (media.waveform.samplesPerSecond <= 0 || serializedBytes(media.waveform) > 500_000)) throw new ConvexError('Invalid transferred waveform');
    if (media.analysis && serializedBytes(media.analysis) > 500_000) throw new ConvexError('Transferred analysis is too large');
    if (media.analysisUpdatedAt !== undefined && media.analysisUpdatedAt < 0 || Object.values(media.analysisCompletedAt ?? {}).some(time => time !== undefined && time < 0)) throw new ConvexError('Invalid analysis timestamp');
  }
  const mediaById = new Map(args.media.map(media => [media.sourceId, media]));
  for (const media of args.media) if (media.audioSourceId) {
    if (media.kind !== 'video' || mediaById.get(media.audioSourceId)?.kind !== 'audio') throw new ConvexError('Linked audio must identify an imported audio source for a video');
  }
  for (const timeline of [args.timeline, ...args.history]) {
    if (storedTimelineBytes(timeline) > 150_000) throw new ConvexError('Transferred timeline is too large');
    for (const clip of timeline.clips) if (clip.assetId && !ids.has(clip.assetId)) throw new ConvexError('A timeline references media outside the transfer');
  }
}

/** Admin-only upload preparation; no project, analysis task or billable job is created. */
export const thumbnailUploadUrl = internalMutation({
  args: ownerArgs, returns: v.string(),
  handler: async (ctx, { ownerId, email }) => {
    await verifiedOwner(ctx, ownerId, email);
    return ctx.storage.generateUploadUrl();
  },
});

/** Imports an already copied, explicitly authorized snapshot in one transaction. */
export const importSnapshot = internalMutation({
  args: snapshotValidator, returns: v.object({ projectId: v.id('projects'), shareId: v.id('timelineShares'), reused: v.boolean() }),
  handler: async (ctx, args) => {
    await verifiedOwner(ctx, args.ownerId, args.email);
    validateSnapshot(args);
    const receipt = await ctx.db.query('projectTransferReceipts').withIndex('by_key', q => q.eq('transferKey', args.transferKey)).unique();
    if (receipt) {
      if (receipt.fingerprint !== args.fingerprint || receipt.ownerId !== args.ownerId || receipt.transferId !== args.transferId || receipt.sourceDeployment !== args.sourceDeployment || receipt.sourceProjectId !== args.sourceProjectId || receipt.sourceRevision !== args.sourceRevision) throw new ConvexError('Transfer key already belongs to a different snapshot or account');
      return { projectId: receipt.projectId, shareId: receipt.shareId, reused: true };
    }
    for (const media of args.media) if (media.thumbnailStorageId) {
      const metadata = await ctx.db.system.get(media.thumbnailStorageId);
      if (!metadata || !metadata.contentType?.startsWith('image/') || metadata.size > 10_000_000) throw new ConvexError('Transferred thumbnail is missing or invalid');
    }
    const now = Date.now(), { ownerId, title, aspectRatio } = args;
    const projectId = await createProject(ctx, { ownerId, title, aspectRatio, createdAt: now, updatedAt: now, revision: args.sourceRevision, history: [] });
    const ids = new Map<string, Id<'assets'>>(), imported = new Map<string, Doc<'assets'>>();
    for (const { sourceId, audioSourceId: _, ...media } of args.media) {
      const id = await ctx.db.insert('assets', { ...media, ownerId, projectId, createdAt: now });
      const asset = await shareAnalysis(ctx, (await ctx.db.get(id))!);
      await recordAssetStorage(ctx, asset);
      ids.set(sourceId, id); imported.set(id, asset);
      if(asset.kind==='video'&&!hasPreview(asset))await enqueueMediaTask(ctx,{ownerId,projectId,assetId:id,kind:'preview'});
    }
    for (const media of args.media) if (media.audioSourceId) {
      const id = ids.get(media.sourceId)!, audioAssetId = ids.get(media.audioSourceId)!;
      await ctx.db.patch(id, { audioAssetId });
      imported.set(id, { ...imported.get(id)!, audioAssetId });
    }
    const remap = (timeline: Snapshot['timeline']) => ({ ...timeline, clips: timeline.clips.map(clip => ({ ...clip, ...(clip.assetId ? { assetId: ids.get(clip.assetId)! } : {}) })) });
    const project = (await ctx.db.get(projectId))!, timeline = remap(args.timeline), history = args.history.map(remap);
    await validateTimeline(ctx, project, timeline);
    for (const snapshot of history) await validateTimeline(ctx, project, snapshot);
    const threadId = await createThread(ctx, components.agent, { userId: ownerId, title });
    await createMessageHistory(ctx, threadId);
    for (let offset = 0; offset < args.conversation.length; offset += 100) {
      await saveMessages(ctx, chatAgent, { threadId, userId: ownerId, agentName: 'Revline', messages: args.conversation.slice(offset, offset + 100).map(({ role, text }) => ({ role, content: text })) });
    }
    await writeProject(ctx, projectId, { timeline, history, threadId });
    const shareId = await ctx.db.insert('timelineShares', { ownerId, projectId, title, timeline: await storeSceneCode(ctx,timeline), ...(args.publicChat.length ? { chat: args.publicChat } : {}), published: true, createdAt: now, updatedAt: now });
    const pinned = new Map<string, Doc<'assets'>>();
    for (const clip of timeline.clips) if (clip.assetId) pinned.set(clip.assetId, imported.get(clip.assetId)!);
    for (const asset of Array.from(pinned.values())) if (asset.audioAssetId) pinned.set(asset.audioAssetId, imported.get(asset.audioAssetId)!);
    for (const asset of pinned.values()) await ctx.db.insert('shareAssets', { shareId, ownerId, ...sharedAssetFields(asset) });
    await ctx.db.insert('projectTransferReceipts', { transferKey: args.transferKey, transferId: args.transferId, sourceDeployment: args.sourceDeployment, sourceProjectId: args.sourceProjectId, sourceRevision: args.sourceRevision, fingerprint: args.fingerprint, ownerId, email: args.email.trim().toLowerCase(), projectId, shareId, createdAt: now });
    return { projectId, shareId, reused: false };
  },
});
