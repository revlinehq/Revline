// The Library page: folders over the account's stored files (`storageObjects`). Files without a folder sit at the root.
import { ConvexError, v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity, uploadPreparationTasks } from './lib/account_limits';
import { mediaDownloadUrl, mediaUrl } from './lib/media_storage';
import { ownedObjectReferences, recordAssetStorage, recordStorageObject } from './lib/storage_accounting';
import { MAX_FOLDERS, MAX_FOLDER_DEPTH, adjustFolderTotals, folderName, freeName, lineage, liveFolderId, ownedFolder, ownerFolders, requireFreeName, siblingNames, type Folder } from './lib/storage_folders';
import { beginProjectDeletion, copyMediaFor } from './projects';
import { importVideoFor } from './mediaTasks';
import { cancelMediaTask } from './lib/media_queue';
import { tableRow } from './lib/exact';
import { attachLibraryUpload, describe, listingReads, storageItem } from './storage';
import { PROJECT_MEDIA_LIMIT } from '../lib/editor/limits';
import { POSTER_MAX_BYTES } from '../lib/editor/poster-frame';

const folderId = v.id('storageFolders');
const folderSummary = { id: folderId, name: v.string(), parentId: v.union(folderId, v.null()), fileCount: v.number(), totalBytes: v.number(), createdAt: v.number(), updatedAt: v.number() };
const summarize = (folder: Folder) => ({ id: folder._id, name: folder.name, parentId: folder.parentId ?? null, fileCount: folder.fileCount, totalBytes: folder.totalBytes, createdAt: folder.createdAt, updatedAt: folder.updatedAt });
const libraryItem = v.object({ ...storageItem.fields, folderId: v.union(folderId, v.null()), duration: v.union(v.number(), v.null()), width: v.union(v.number(), v.null()), height: v.union(v.number(), v.null()), waveform: v.union(v.array(v.number()), v.null()),
  /** A video or export with no poster (one only the Library holds): its own link, so the tile can show its first frame. */
  videoUrl: v.union(v.string(), v.null()) });
const visible = (ownerId: string) => ({ ownerId, auxiliary: false, pending: false }) as const;
const STARTER_FOLDERS = ['Raw footage', 'Exports', 'Audio', 'Images'];
const WAVEFORM_BARS = 48;
/** Folder tiles that show thumbnails; the rest of a longer row show the folder alone. */
const THUMBNAIL_FOLDERS = 48;
/** Files one folder deletion moves per transaction; the rest follow in scheduled batches. */
const DRAIN_BATCH = 500;

/** A stored waveform reduced to a few bars (0..1) for a tile. Null when there is none or it is too large to read in a listing. */
function waveformBars(waveform: Doc<'assets'>['waveform'] | null) {
  if (!waveform || waveform.peaks.length > 600_000) return null;
  const samples = Uint8Array.from(atob(waveform.peaks), value => value.charCodeAt(0));
  if (!samples.length) return null;
  const bars: number[] = [], step = samples.length / WAVEFORM_BARS;
  let maximum = 32;
  for (let index = 0; index < WAVEFORM_BARS; index++) {
    let peak = 0;
    for (let at = Math.floor(index * step), end = Math.max(at + 1, Math.floor((index + 1) * step)); at < end && at < samples.length; at++) peak = Math.max(peak, samples[at]);
    bars.push(peak); maximum = Math.max(maximum, peak);
  }
  return bars.map(value => Math.round(value / maximum * 100) / 100);
}
/** The small picture a folder tile shows for one file: the editor's thumbnail, the image itself, or, for a video
 * that only the Library holds (no project made a poster for it), the video, whose first frame the tile draws. */
async function tileThumbnail(ctx: QueryCtx, row: Doc<'storageObjects'>) {
  if (row.kind !== 'video' && row.kind !== 'image' && row.kind !== 'export') return null;
  const attachments = row.kind === 'export' ? [] : row.r2Key ? await ctx.db.query('assets').withIndex('by_owner_r2Key', q => q.eq('ownerId', row.ownerId).eq('r2Key', row.r2Key)).take(3)
    : row.storageId ? await ctx.db.query('assets').withIndex('by_owner_storageId', q => q.eq('ownerId', row.ownerId).eq('storageId', row.storageId)).take(3) : [];
  const posters = attachments.find(asset => asset.thumbnailStorageId)?.thumbnailStorageId;
  const library = !posters && row.kind === 'video' && row.r2Key ? await ctx.db.query('cloudMedia').withIndex('by_r2Key', q => q.eq('r2Key', row.r2Key!)).first() : null;
  const thumbnail = posters ?? (library?.ownerId === row.ownerId ? library.thumbnailStorageId : undefined);
  const url = thumbnail ? await ctx.storage.getUrl(thumbnail) : await mediaUrl(ctx, row);
  return url ? { url, video: !thumbnail && row.kind !== 'image' } : null;
}
const tileThumbnailValue = v.object({ url: v.string(), video: v.boolean() });

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The folders directly inside `parentId` (the root when absent), each with its subtree totals and up to three
 * thumbnails from its newest files. */
export const folders = query({ args: { parentId: v.optional(folderId) }, returns: v.array(v.object({ ...folderSummary, thumbnails: v.array(tileThumbnailValue) })), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  if (args.parentId && (await ctx.db.get(args.parentId))?.ownerId !== ownerId) return [];
  const rows = (await ctx.db.query('storageFolders').withIndex('by_owner_parent', q => q.eq('ownerId', ownerId).eq('parentId', args.parentId)).take(MAX_FOLDERS)).filter(row => !row.deleting);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(rows.map(async (folder, index) => {
    // Pictures come from the three newest files directly in the folder, by index, for the first tiles only:
    // a long row of folders does not read every folder's files.
    const newest = folder.fileCount && index < THUMBNAIL_FOLDERS ? await ctx.db.query('storageObjects').withIndex('by_owner_folder_created', q => q.eq('ownerId', ownerId).eq('auxiliary', false).eq('pending', false).eq('folderId', folder._id)).order('desc').take(3) : [];
    const thumbnails = (await Promise.all(newest.map(row => tileThumbnail(ctx, row)))).filter(thumbnail => thumbnail !== null);
    return { ...summarize(folder), thumbnails };
  }));
} });
/** Every folder of the account, flat: the Move dialog's tree and the folder search. */
export const folderTree = query({ args: {}, returns: v.array(v.object(folderSummary)), handler: async ctx => {
  const all = await ownerFolders(ctx, await requireOwner(ctx));
  return [...all.values()].map(summarize).sort((a, b) => a.name.localeCompare(b.name));
} });
/** The breadcrumb for a folder, outermost first. Null when the folder is gone or the ID is not a folder's. */
export const folderPath = query({ args: { folderId: v.string() }, returns: v.union(v.null(), v.array(v.object({ id: folderId, name: v.string() }))), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), path: { id: Id<'storageFolders'>; name: string }[] = [];
  // The ID comes from the page address, so anything may arrive here.
  const start = ctx.db.normalizeId('storageFolders', args.folderId);
  if (!start) return null;
  for (let id: Id<'storageFolders'> | undefined = start; id && path.length <= MAX_FOLDER_DEPTH + 1;) {
    const folder: Folder | null = await ctx.db.get(id);
    if (!folder || folder.ownerId !== ownerId || folder.deleting) return null;
    path.unshift({ id: folder._id, name: folder.name }); id = folder.parentId;
  }
  return path;
} });
/** The files directly in one folder (the root when `folderId` is absent). A search covers the whole Library. */
export const files = query({ args: { paginationOpts: paginationOptsValidator, folderId: v.optional(folderId), search: v.optional(v.string()), unused: v.optional(v.boolean()), sort: v.union(v.literal('newest'), v.literal('oldest'), v.literal('largest')) },
  returns: v.object({ page: v.array(libraryItem), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal('SplitRecommended'), v.literal('SplitRequired'), v.null())) }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 40) throw new ConvexError('Load up to 40 files');
    const search = args.search?.trim() ?? ''; if (search.length > 120) throw new ConvexError('Search is too long');
    if (args.folderId && (await ctx.db.get(args.folderId))?.ownerId !== ownerId) return { page: [], isDone: true, continueCursor: '' };
    const base = ctx.db.query('storageObjects'), scope = visible(ownerId);
    const index = args.sort === 'largest' ? 'by_owner_folder_size' : 'by_owner_folder_created';
    const listing = search ? base.withSearchIndex('search_name', q => q.search('fileName', search).eq('ownerId', ownerId).eq('auxiliary', false).eq('pending', false))
      : base.withIndex(index, q => q.eq('ownerId', scope.ownerId).eq('auxiliary', scope.auxiliary).eq('pending', scope.pending).eq('folderId', args.folderId)).order(args.sort === 'oldest' ? 'asc' : 'desc');
    const page = await listing.paginate(args.paginationOpts);
    const reads = listingReads(ctx), rows = await Promise.all(page.page.map(async row => {
      const { peaks, ...file } = await describe(ctx, row, reads);
      const videoUrl = (file.kind === 'video' || file.kind === 'export') && !file.thumbnailUrl ? await mediaUrl(ctx, row) : null;
      return { ...file, folderId: row.folderId ?? null, waveform: waveformBars(peaks), videoUrl };
    }));
    return { ...page, page: args.unused ? rows.filter(row => row.canDelete && !row.inUse) : rows };
  } });

/** A link that plays or shows one stored file in the details panel. Null for kinds with no in-page preview. */
export const previewUrl = query({ args: { fileId: v.id('storageObjects') }, returns: v.union(v.string(), v.null()), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), row = await ctx.db.get(args.fileId);
  if (!row || row.ownerId !== ownerId || row.pending || row.auxiliary || row.kind === 'model') return null;
  return mediaUrl(ctx, row);
} });

// ── Folders ─────────────────────────────────────────────────────────────────────────────────────────────────

async function insertFolder(ctx: MutationCtx, ownerId: string, all: Map<Id<'storageFolders'>, Folder>, name: string, parentId?: Id<'storageFolders'>) {
  if (all.size >= MAX_FOLDERS) throw new ConvexError(`The Library holds up to ${MAX_FOLDERS} folders`);
  const now = Date.now();
  return ctx.db.insert('storageFolders', { ownerId, name, ...(parentId ? { parentId } : {}), createdAt: now, updatedAt: now, fileCount: 0, totalBytes: 0 });
}
export const createFolder = mutation({ args: { name: v.string(), parentId: v.optional(folderId) }, returns: folderId, handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), name = folderName(args.name), all = await ownerFolders(ctx, ownerId);
  if (args.parentId) {
    if (all.get(args.parentId)?.ownerId !== ownerId) throw new ConvexError('Folder not found');
    if (lineage(all, args.parentId).length >= MAX_FOLDER_DEPTH) throw new ConvexError(`Folders nest up to ${MAX_FOLDER_DEPTH} levels`);
  }
  requireFreeName(siblingNames(all, args.parentId), name);
  return insertFolder(ctx, ownerId, all, name, args.parentId);
} });
/** The suggested starting folders, created empty at the root. Names that already exist there are skipped; no file moves. */
export const createStarterFolders = mutation({ args: {}, returns: v.array(folderId), handler: async ctx => {
  const ownerId = await requireOwner(ctx), all = await ownerFolders(ctx, ownerId), taken = siblingNames(all, undefined).map(name => name.toLocaleLowerCase());
  const created: Id<'storageFolders'>[] = [];
  for (const name of STARTER_FOLDERS) {
    if (taken.includes(name.toLocaleLowerCase())) continue;
    if (all.size + created.length >= MAX_FOLDERS) break;
    created.push(await insertFolder(ctx, ownerId, all, name));
  }
  return created;
} });
export const renameFolder = mutation({ args: { folderId, name: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), folder = await ownedFolder(ctx, ownerId, args.folderId), name = folderName(args.name);
  if (name === folder.name) return null;
  requireFreeName(siblingNames(await ownerFolders(ctx, ownerId), folder.parentId, folder._id), name);
  await ctx.db.patch(folder._id, { name, updatedAt: Date.now() });
  return null;
} });
/** Moves files and folders into `targetFolderId` (the root when absent). A folder cannot move into itself or anything inside it. */
export const move = mutation({ args: { fileIds: v.array(v.id('storageObjects')), folderIds: v.array(folderId), targetFolderId: v.optional(folderId) }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), fileIds = [...new Set(args.fileIds)], folderIds = [...new Set(args.folderIds)], target = args.targetFolderId;
  if (!fileIds.length && !folderIds.length) throw new ConvexError('Choose what to move');
  if (fileIds.length > 100 || folderIds.length > 20) throw new ConvexError('Move up to 100 files and 20 folders at a time');
  const all = await ownerFolders(ctx, ownerId);
  if (target && all.get(target)?.ownerId !== ownerId) throw new ConvexError('Folder not found');
  const now = Date.now();
  for (const id of folderIds) {
    const known = all.get(id);
    if (!known || known.ownerId !== ownerId) throw new ConvexError('Folder not found');
    if (known.parentId === target) continue;
    const above = lineage(all, target);
    if (above.some(folder => folder._id === id)) throw new ConvexError(`“${known.name}” cannot move into itself or a folder inside it`);
    // Levels the moved folder brings with it, counted from its deepest descendant.
    const height = Math.max(...[...all.values()].map(folder => { const path = lineage(all, folder._id), at = path.findIndex(step => step._id === id); return at < 0 ? 0 : at + 1; }));
    if (above.length + height > MAX_FOLDER_DEPTH) throw new ConvexError(`Folders nest up to ${MAX_FOLDER_DEPTH} levels`);
    requireFreeName(siblingNames(all, target, id), known.name);
    // Totals may have changed earlier in this call.
    const folder = (await ctx.db.get(id))!;
    await adjustFolderTotals(ctx, folder.parentId, -folder.fileCount, -folder.totalBytes);
    await ctx.db.patch(id, { parentId: target, updatedAt: now });
    await adjustFolderTotals(ctx, target, folder.fileCount, folder.totalBytes);
    all.set(id, { ...folder, parentId: target });
  }
  const left = new Map<Id<'storageFolders'>, { files: number; bytes: number }>();
  let files = 0, bytes = 0;
  for (const id of fileIds) {
    const row = await ctx.db.get(id);
    if (!row || row.ownerId !== ownerId || row.pending || row.auxiliary) throw new ConvexError('File not found');
    if (row.folderId === target) continue;
    if (row.folderId) { const from = left.get(row.folderId) ?? { files: 0, bytes: 0 }; from.files++; from.bytes += row.size; left.set(row.folderId, from); }
    await ctx.db.patch(id, { folderId: target });
    files++; bytes += row.size;
  }
  for (const [id, from] of left) await adjustFolderTotals(ctx, id, -from.files, -from.bytes);
  await adjustFolderTotals(ctx, target, files, bytes);
  return null;
} });
const linkImportState = v.object({ taskId: v.id('mediaTasks'), status: v.string(), progress: v.number(), attempt: v.number(), error: v.optional(v.string()) });
/** Saves a video link (YouTube, TikTok, Instagram…) into the Library, in `folderId` when given. Imports always run in a
 * project, so this one runs in a holding project of its own; `settleLinkImport` files it and removes the holder. */
export const importLink = mutation({ args: { url: v.string(), folderId: v.optional(folderId) }, returns: v.id('mediaTasks'), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  const folder = args.folderId ? (await ownedFolder(ctx, ownerId, args.folderId))._id : undefined;
  const { taskId, projectId } = await importVideoFor(ctx, ownerId, { url: args.url, sourcesOnly: true });
  if (!await ctx.db.query('libraryLinkImports').withIndex('by_task', q => q.eq('taskId', taskId)).first())
    await ctx.db.insert('libraryLinkImports', { ownerId, taskId, projectId, createdAt: Date.now(), ...(folder ? { folderId: folder } : {}) });
  // A link this holder already had finishes at once, without a status change to report it.
  if ((await ctx.db.get(taskId))?.status === 'completed') await ctx.scheduler.runAfter(0, internal.library.settleLinkImport, { taskId });
  return taskId;
} });
/** Link imports still running, or failed and not yet dismissed, newest first. */
export const linkImports = query({ args: {}, returns: v.array(linkImportState), handler: async ctx => {
  const ownerId = await requireOwner(ctx);
  const rows = await ctx.db.query('libraryLinkImports').withIndex('by_owner_created', q => q.eq('ownerId', ownerId)).order('desc').take(20);
  const states = await Promise.all(rows.map(async row => {
    const task = await ctx.db.get(row.taskId);
    if (!task || task.ownerId !== ownerId || task.status === 'completed' || task.status === 'cancelled') return null;
    const progress = (await ctx.db.query('mediaTaskProgress').withIndex('by_task', q => q.eq('taskId', task._id)).unique())?.progress ?? task.progress;
    return { taskId: task._id, status: task.status, progress, attempt: task.attempt, ...(task.error ? { error: task.error } : {}) };
  }));
  return states.filter(state => state !== null);
} });
/** Removes a failed (or still running) link import and its holding project. */
export const dismissLinkImport = mutation({ args: { taskId: v.id('mediaTasks') }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), row = await ctx.db.query('libraryLinkImports').withIndex('by_task', q => q.eq('taskId', args.taskId)).first();
  if (!row || row.ownerId !== ownerId) return null;
  await ctx.db.delete(row._id);
  await cancelMediaTask(ctx, args.taskId);
  await removeHolder(ctx, row);
  return null;
} });
/** Only the import's own holder goes: titled as `importVideoFor` names it, holding nothing but this video and its audio. */
async function removeHolder(ctx: MutationCtx, row: Doc<'libraryLinkImports'>, keep?: Doc<'assets'>) {
  const project = await ctx.db.get(row.projectId);
  if (!project || project.ownerId !== row.ownerId || project.deleting || project.title !== 'Video import') return;
  const assets = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', row.ownerId).eq('projectId', project._id)).take(10);
  if (assets.every(item => keep && (item._id === keep._id || item._id === keep.audioAssetId))) await beginProjectDeletion(ctx, row.ownerId, project);
}
/** Runs when a Library link import ends. Completed: the video is held the way a Library upload is (a completed
 * `cloudMedia` row), filed in its folder (or the nearest live parent), and the holder removed. Cancelled: the holder is
 * removed. Failed: kept, so the Library shows why until it is dismissed. */
export const settleLinkImport = internalMutation({ args: { taskId: v.id('mediaTasks') }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.query('libraryLinkImports').withIndex('by_task', q => q.eq('taskId', args.taskId)).first(), task = await ctx.db.get(args.taskId);
  if (!row) return null;
  if (!task || task.status === 'cancelled') { await ctx.db.delete(row._id); await removeHolder(ctx, row); return null; }
  if (task.status !== 'completed') return null;
  await ctx.db.delete(row._id);
  const ownerId = row.ownerId, asset = task.outputAssetId ? await ctx.db.get(task.outputAssetId) : null;
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== row.projectId || asset.kind !== 'video' || !asset.r2Key) return null;
  const now = Date.now(), r2Key = asset.r2Key;
  if (!await ctx.db.query('cloudMedia').withIndex('by_r2Key', q => q.eq('r2Key', r2Key)).first())
    await ctx.db.insert('cloudMedia', tableRow<'cloudMedia'>()({ ownerId, r2Key, uploadId: `import:${task._id}`, fileName: asset.fileName, contentType: asset.contentType || 'video/mp4', kind: 'video', size: asset.size ?? 0, partSize: 0,
      ...(asset.duration !== undefined ? { duration: asset.duration } : {}), ...(asset.width !== undefined ? { width: asset.width } : {}), ...(asset.height !== undefined ? { height: asset.height } : {}),
      createdAt: now, activeAt: now, expiresAt: now, completed: true, direct: true }));
  const file = await ctx.db.query('storageObjects').withIndex('by_owner_key', q => q.eq('ownerId', ownerId).eq('objectKey', `r2:${r2Key}`)).unique();
  const target = await liveFolderId(ctx, ownerId, row.folderId);
  if (file && !file.pending && !file.auxiliary && file.folderId !== target) {
    await adjustFolderTotals(ctx, file.folderId, -1, -file.size);
    await ctx.db.patch(file._id, { folderId: target });
    await adjustFolderTotals(ctx, target, 1, file.size);
  }
  await removeHolder(ctx, row, asset);
  return null;
} });
/** Moves up to `DRAIN_BATCH` files out of a folder into `parentId`. True when none are left. The parent's totals
 * already include them, so no total changes. */
async function drainFiles(ctx: MutationCtx, folder: Folder) {
  let budget = DRAIN_BATCH;
  const parentId = await liveFolderId(ctx, folder.ownerId, folder.parentId);
  // Unfinished uploads move too, so they finish in the parent.
  for (const pending of [false, true]) {
    const rows = await ctx.db.query('storageObjects').withIndex('by_owner_folder_created', q => q.eq('ownerId', folder.ownerId).eq('auxiliary', false).eq('pending', pending).eq('folderId', folder._id)).take(budget + 1);
    for (const row of rows.slice(0, budget)) await ctx.db.patch(row._id, { folderId: parentId });
    if (rows.length > budget) return false;
    budget -= rows.length;
  }
  return true;
}
export const drainFolder = internalMutation({ args: { folderId }, returns: v.null(), handler: async (ctx, args) => {
  const folder = await ctx.db.get(args.folderId);
  if (!folder?.deleting) return null;
  if (await drainFiles(ctx, folder)) await ctx.db.delete(folder._id);
  else await ctx.scheduler.runAfter(0, internal.library.drainFolder, args);
  return null;
} });
/** Deletes a folder only. Everything inside it (files and folders) moves up into the folder that held it; no file is
 * deleted. A subfolder whose name is taken there gets a number added. */
export const removeFolder = mutation({ args: { folderId }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), folder = await ownedFolder(ctx, ownerId, args.folderId), now = Date.now();
  const names = siblingNames(await ownerFolders(ctx, ownerId), folder.parentId, folder._id);
  // A subfolder still handing its files up (being deleted itself) moves too, so those files keep a live parent.
  const children = await ctx.db.query('storageFolders').withIndex('by_owner_parent', q => q.eq('ownerId', ownerId).eq('parentId', folder._id)).take(MAX_FOLDERS + 100);
  for (const child of children) {
    const name = child.deleting ? child.name : freeName(names, child.name);
    if (!child.deleting) names.push(name);
    await ctx.db.patch(child._id, { parentId: folder.parentId, name, updatedAt: now });
  }
  if (await drainFiles(ctx, folder)) await ctx.db.delete(folder._id);
  else {
    await ctx.db.patch(folder._id, { deleting: true });
    await ctx.scheduler.runAfter(0, internal.library.drainFolder, { folderId: folder._id });
  }
  return null;
} });

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────────────

async function ownedFile(ctx: QueryCtx | MutationCtx, ownerId: string, fileId: Id<'storageObjects'>) {
  const row = await ctx.db.get(fileId);
  if (!row || row.ownerId !== ownerId || row.pending || row.auxiliary) throw new ConvexError('File not found');
  return row;
}
/** Renames the Library entry. The file keeps its extension: it is added back when the new name does not end with it.
 * Project media keeps its own name. */
export const renameFile = mutation({ args: { fileId: v.id('storageObjects'), name: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const row = await ownedFile(ctx, await requireOwner(ctx), args.fileId);
  let name = args.name.trim().replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(row.fileName)?.[0];
  if (name && extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name += extension;
  if (!name || name.length > 255) throw new ConvexError('A file name needs between 1 and 255 characters');
  if (name !== row.fileName) await ctx.db.patch(row._id, { fileName: name });
  return name;
} });
export const downloadSource = internalQuery({ args: { fileId: v.id('storageObjects') }, returns: v.object({ r2Key: v.optional(v.string()), storageId: v.optional(v.id('_storage')), fileName: v.string() }), handler: async (ctx, args) => {
  const row = await ownedFile(ctx, await requireOwner(ctx), args.fileId);
  return { ...(row.r2Key ? { r2Key: row.r2Key } : {}), ...(row.storageId ? { storageId: row.storageId } : {}), fileName: row.fileName };
} });
/** A download link for one stored file, signed for 15 minutes. */
export const downloadUrl = action({ args: { fileId: v.id('storageObjects') }, returns: v.string(), handler: async (ctx, args): Promise<string> => {
  const source: { r2Key?: string; storageId?: Id<'_storage'>; fileName: string } = await ctx.runQuery(internal.library.downloadSource, args);
  const url = await mediaDownloadUrl(ctx, source, source.fileName);
  if (!url) throw new ConvexError('File not found');
  return url;
} });

// ── Posters ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A Library upload (`uploadId`) or a listed file (`fileId`). */
const posterTarget = { uploadId: v.optional(v.id('cloudMedia')), fileId: v.optional(v.id('storageObjects')) };
/** The Library-held video that still needs a poster: a finished upload or link import of the owner's, with no
 * poster of its own and none from a project holding the same file. Null for anything else. */
async function posterHolder(ctx: QueryCtx | MutationCtx, ownerId: string, target: { uploadId?: Id<'cloudMedia'>; fileId?: Id<'storageObjects'> }) {
  const file = target.fileId ? await ctx.db.get(target.fileId) : null;
  if (target.fileId && (!file || file.ownerId !== ownerId)) return null;
  const r2Key = file?.r2Key;
  const library = target.uploadId ? await ctx.db.get(target.uploadId) : r2Key ? await ctx.db.query('cloudMedia').withIndex('by_r2Key', q => q.eq('r2Key', r2Key)).first() : null;
  if (!library || library.ownerId !== ownerId || !library.completed || library.aborting || library.kind !== 'video' || library.thumbnailStorageId) return null;
  const posters = await ctx.db.query('assets').withIndex('by_owner_r2Key', q => q.eq('ownerId', ownerId).eq('r2Key', library.r2Key)).take(3);
  return posters.some(asset => asset.thumbnailStorageId) ? null : library;
}
export const posterNeeded = internalQuery({ args: posterTarget, returns: v.boolean(), handler: async (ctx, args) => !!await posterHolder(ctx, await requireOwner(ctx), args) });
export const attachPoster = internalMutation({ args: { ...posterTarget, storageId: v.id('_storage') }, returns: v.boolean(), handler: async (ctx, { storageId, ...target }) => {
  const ownerId = await requireOwner(ctx), library = await posterHolder(ctx, ownerId, target), metadata = await ctx.db.system.get(storageId);
  // Another tab may have saved one meanwhile: the first poster stays.
  if (!library || !metadata || metadata.contentType !== 'image/jpeg' || metadata.size > POSTER_MAX_BYTES) { await ctx.storage.delete(storageId); return false; }
  await ctx.db.patch(library._id, { thumbnailStorageId: storageId });
  await recordStorageObject(ctx, { ownerId, storageId, fileName: `${library.fileName} thumbnail`, size: metadata.size, kind: 'image', createdAt: library.createdAt, auxiliary: true });
  return true;
} });
/** Stores the small JPEG poster of a video only the Library holds (a Library upload or link import), so its tile loads
 * a picture instead of the video. The browser takes it the way it takes a project upload's poster: at upload, or, for a
 * link import or an older file, once from the tile that shows the video. A file that has a poster keeps it. */
export const saveThumbnail = action({ args: { ...posterTarget, image: v.bytes() }, returns: v.boolean(), handler: async (ctx, { image, ...target }): Promise<boolean> => {
  if (!target.uploadId === !target.fileId) throw new ConvexError('Name one file');
  const bytes = new Uint8Array(image);
  if (bytes.length > POSTER_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new ConvexError(`Use a JPEG poster under ${POSTER_MAX_BYTES / 1024} KB`);
  if (!await ctx.runQuery(internal.library.posterNeeded, target)) return false;
  const storageId = await ctx.storage.store(new Blob([bytes], { type: 'image/jpeg' }));
  try { return await ctx.runMutation(internal.library.attachPoster, { ...target, storageId }); }
  catch (error) { await ctx.storage.delete(storageId); throw error; }
} });
/** Puts stored files into an existing project's media (not on its timeline). A file the project already has is left as it is. */
export const addToProject = mutation({ args: { fileIds: v.array(v.id('storageObjects')), projectId: v.id('projects') }, returns: v.object({ added: v.number(), existing: v.number() }), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await requireProject(ctx, args.projectId, ownerId, false, false);
  await requireEditorAccess(ctx, ownerId);
  const ids = [...new Set(args.fileIds)];
  if (!ids.length || ids.length > 20) throw new ConvexError('Choose between 1 and 20 files');
  let added = 0, existing = 0;
  const copies: { source: Doc<'assets'>; fileName: string }[] = [], uploads: { library: Doc<'cloudMedia'>; fileName: string }[] = [];
  for (const id of ids) {
    const row = await ownedFile(ctx, ownerId, id);
    if (row.kind === 'export') throw new ConvexError('An export cannot be added to a project. Download it and upload it as footage.');
    const refs = await ownedObjectReferences(ctx, ownerId, row), owned = refs.attachments.filter(asset => asset.ownerId === ownerId);
    if (owned.some(asset => asset.projectId === project._id)) { existing++; continue; }
    // An attachment in a live project is copied the way the editor copies media between projects.
    let source: Doc<'assets'> | undefined;
    for (const asset of owned) { const home = await ctx.db.get(asset.projectId); if (home && !home.deleting && home.ownerId === ownerId) { source = asset; break; } }
    const library = refs.library?.ownerId === ownerId && refs.library.completed && !refs.library.aborting ? refs.library : null;
    if (source) copies.push({ source, fileName: row.fileName });
    else if (library) uploads.push({ library, fileName: row.fileName });
    else throw new ConvexError(`${row.fileName} is no longer available`);
  }
  if (copies.length) {
    // The copy refuses media still being prepared; say so in this page's words first.
    for (const { source, fileName } of copies) {
      const tasks = await ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', source._id)).order('desc').take(50);
      if (tasks.some(task => ['queued', 'running', 'retrying'].includes(task.status))) throw new ConvexError(`${fileName} is still being prepared in its project. Add it once that finishes.`);
    }
    const results = await copyMediaFor(ctx, ownerId, project._id, copies.map(copy => copy.source._id));
    for (const [index, result] of results.entries()) {
      if (!result.copied) { existing++; continue; }
      added++;
      if (copies[index].source.fileName !== copies[index].fileName) await ctx.db.patch(result.assetId, { fileName: copies[index].fileName });
    }
  }
  if (uploads.length) {
    const inProject = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', project._id)).take(PROJECT_MEDIA_LIMIT + 1);
    if (inProject.length + uploads.length > PROJECT_MEDIA_LIMIT) throw new ConvexError(`A project supports up to ${PROJECT_MEDIA_LIMIT} media files`);
    const preparation = uploads.reduce((total, upload) => total + uploadPreparationTasks(upload.library.kind), 0);
    if (preparation) await requireMediaTaskCapacity(ctx, ownerId, preparation);
    for (const { library, fileName } of uploads) { await recordAssetStorage(ctx, (await attachLibraryUpload(ctx, ownerId, project._id, library, fileName))!); added++; }
  }
  return { added, existing };
} });
