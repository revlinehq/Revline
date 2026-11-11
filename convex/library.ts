// The Library page: folders over the account's stored files (`storageObjects`). Files without a folder sit at the root.
import { ConvexError, v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity, uploadPreparationTasks } from './lib/account_limits';
import { enqueueMediaTask } from './lib/media_queue';
import { mediaDownloadUrl, mediaUrl } from './lib/media_storage';
import { ownedObjectReferences, recordAssetStorage } from './lib/storage_accounting';
import { MAX_FOLDERS, MAX_FOLDER_DEPTH, adjustFolderTotals, folderName, freeName, lineage, ownedFolder, ownerFolders, requireFreeName, siblingNames, type Folder } from './lib/storage_folders';
import { copyMediaFor } from './projects';
import { describe, listingReads, storageItem } from './storage';
import { PROJECT_MEDIA_LIMIT } from '../lib/editor/limits';

const folderId = v.id('storageFolders');
const folderSummary = { id: folderId, name: v.string(), parentId: v.union(folderId, v.null()), fileCount: v.number(), totalBytes: v.number(), createdAt: v.number(), updatedAt: v.number() };
const summarize = (folder: Folder) => ({ id: folder._id, name: folder.name, parentId: folder.parentId ?? null, fileCount: folder.fileCount, totalBytes: folder.totalBytes, createdAt: folder.createdAt, updatedAt: folder.updatedAt });
const libraryItem = v.object({ ...storageItem.fields, folderId: v.union(folderId, v.null()), duration: v.union(v.number(), v.null()), waveform: v.union(v.array(v.number()), v.null()) });
const visible = (ownerId: string) => ({ ownerId, auxiliary: false, pending: false }) as const;
const STARTER_FOLDERS = ['Raw footage', 'Exports', 'Audio', 'Images'];
const WAVEFORM_BARS = 48;
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
/** The small picture a folder tile shows for one file: the editor's thumbnail, or the image itself. */
async function tileThumbnail(ctx: QueryCtx, row: Doc<'storageObjects'>) {
  if (row.kind !== 'video' && row.kind !== 'image') return null;
  const attachments = row.r2Key ? await ctx.db.query('assets').withIndex('by_owner_r2Key', q => q.eq('ownerId', row.ownerId).eq('r2Key', row.r2Key)).take(8)
    : row.storageId ? await ctx.db.query('assets').withIndex('by_owner_storageId', q => q.eq('ownerId', row.ownerId).eq('storageId', row.storageId)).take(8) : [];
  const thumbnail = attachments.find(asset => asset.thumbnailStorageId)?.thumbnailStorageId;
  return thumbnail ? ctx.storage.getUrl(thumbnail) : row.kind === 'image' ? mediaUrl(ctx, row) : null;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The folders directly inside `parentId` (the root when absent), each with its subtree totals and up to three
 * thumbnails from its newest files. */
export const folders = query({ args: { parentId: v.optional(folderId) }, returns: v.array(v.object({ ...folderSummary, thumbnails: v.array(v.string()) })), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  if (args.parentId && (await ctx.db.get(args.parentId))?.ownerId !== ownerId) return [];
  const rows = (await ctx.db.query('storageFolders').withIndex('by_owner_parent', q => q.eq('ownerId', ownerId).eq('parentId', args.parentId)).take(MAX_FOLDERS)).filter(row => !row.deleting);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(rows.map(async folder => {
    // Six newest direct files are enough to find three with a picture.
    const newest = folder.fileCount ? await ctx.db.query('storageObjects').withIndex('by_owner_folder_created', q => q.eq('ownerId', ownerId).eq('auxiliary', false).eq('pending', false).eq('folderId', folder._id)).order('desc').take(6) : [];
    const thumbnails = (await Promise.all(newest.map(row => tileThumbnail(ctx, row)))).filter(url => url !== null).slice(0, 3);
    return { ...summarize(folder), thumbnails };
  }));
} });
/** Every folder of the account, flat: the Move dialog's tree and the folder search. */
export const folderTree = query({ args: {}, returns: v.array(v.object(folderSummary)), handler: async ctx => {
  const all = await ownerFolders(ctx, await requireOwner(ctx));
  return [...all.values()].map(summarize).sort((a, b) => a.name.localeCompare(b.name));
} });
/** The breadcrumb for a folder, outermost first. Null when the folder is gone. */
export const folderPath = query({ args: { folderId }, returns: v.union(v.null(), v.array(v.object({ id: folderId, name: v.string() }))), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), path: { id: Id<'storageFolders'>; name: string }[] = [];
  for (let id: Id<'storageFolders'> | undefined = args.folderId; id && path.length <= MAX_FOLDER_DEPTH + 1;) {
    const folder: Folder | null = await ctx.db.get(id);
    if (!folder || folder.ownerId !== ownerId || folder.deleting) return null;
    path.unshift({ id: folder._id, name: folder.name }); id = folder.parentId;
  }
  return path;
} });
/** The files directly in one folder (the root when `folderId` is absent). A search covers the whole Library. */
export const files = query({ args: { paginationOpts: paginationOptsValidator, folderId: v.optional(folderId), search: v.optional(v.string()), unused: v.optional(v.boolean()), sort: v.union(v.literal('newest'), v.literal('oldest'), v.literal('largest'), v.literal('name')) },
  returns: v.object({ page: v.array(libraryItem), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal('SplitRecommended'), v.literal('SplitRequired'), v.null())) }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 40) throw new ConvexError('Load up to 40 files');
    const search = args.search?.trim() ?? ''; if (search.length > 120) throw new ConvexError('Search is too long');
    if (args.folderId && (await ctx.db.get(args.folderId))?.ownerId !== ownerId) return { page: [], isDone: true, continueCursor: '' };
    const base = ctx.db.query('storageObjects'), scope = visible(ownerId);
    const index = args.sort === 'largest' ? 'by_owner_folder_size' : args.sort === 'name' ? 'by_owner_folder_name' : 'by_owner_folder_created';
    const listing = search ? base.withSearchIndex('search_name', q => q.search('fileName', search).eq('ownerId', ownerId).eq('auxiliary', false).eq('pending', false))
      : base.withIndex(index, q => q.eq('ownerId', scope.ownerId).eq('auxiliary', scope.auxiliary).eq('pending', scope.pending).eq('folderId', args.folderId)).order(args.sort === 'oldest' || args.sort === 'name' ? 'asc' : 'desc');
    const page = await listing.paginate(args.paginationOpts);
    const reads = listingReads(ctx), rows = await Promise.all(page.page.map(async row => {
      const { peaks, ...file } = await describe(ctx, row, reads);
      return { ...file, folderId: row.folderId ?? null, waveform: waveformBars(peaks) };
    }));
    return { ...page, page: args.unused ? rows.filter(row => row.canDelete && !row.inUse) : rows };
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
/** Moves up to `DRAIN_BATCH` files out of a folder into `parentId`. True when none are left. The parent's totals
 * already include them, so no total changes. */
async function drainFiles(ctx: MutationCtx, folder: Folder) {
  let budget = DRAIN_BATCH;
  // Unfinished uploads move too, so they finish in the parent.
  for (const pending of [false, true]) {
    const rows = await ctx.db.query('storageObjects').withIndex('by_owner_folder_created', q => q.eq('ownerId', folder.ownerId).eq('auxiliary', false).eq('pending', pending).eq('folderId', folder._id)).take(budget + 1);
    for (const row of rows.slice(0, budget)) await ctx.db.patch(row._id, { folderId: folder.parentId });
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
export const removeFolder = mutation({ args: { folderId }, returns: v.object({ files: v.number(), folders: v.number() }), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), folder = await ownedFolder(ctx, ownerId, args.folderId), all = await ownerFolders(ctx, ownerId), now = Date.now();
  const children = [...all.values()].filter(child => child.parentId === folder._id), names = siblingNames(all, folder.parentId, folder._id);
  const direct = { files: folder.fileCount - children.reduce((sum, child) => sum + child.fileCount, 0), folders: children.length };
  for (const child of children) {
    const name = freeName(names, child.name); names.push(name);
    await ctx.db.patch(child._id, { parentId: folder.parentId, name, updatedAt: now });
  }
  if (await drainFiles(ctx, folder)) await ctx.db.delete(folder._id);
  else {
    await ctx.db.patch(folder._id, { deleting: true });
    await ctx.scheduler.runAfter(0, internal.library.drainFolder, { folderId: folder._id });
  }
  return direct;
} });

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────────────

async function ownedFile(ctx: QueryCtx | MutationCtx, ownerId: string, fileId: Id<'storageObjects'>) {
  const row = await ctx.db.get(fileId);
  if (!row || row.ownerId !== ownerId || row.pending || row.auxiliary) throw new ConvexError('File not found');
  return row;
}
/** Renames the Library entry. A name typed without an extension keeps the old one. Project media keeps its own name. */
export const renameFile = mutation({ args: { fileId: v.id('storageObjects'), name: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const row = await ownedFile(ctx, await requireOwner(ctx), args.fileId);
  let name = args.name.trim().replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(row.fileName)?.[0];
  if (name && extension && !/\.[A-Za-z0-9]{1,8}$/.test(name)) name += extension;
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
/** Puts stored files into an existing project's media (not on its timeline). A file the project already has is left as it is. */
export const addToProject = mutation({ args: { fileIds: v.array(v.id('storageObjects')), projectId: v.id('projects') }, returns: v.object({ added: v.number(), existing: v.number() }), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await requireProject(ctx, args.projectId, ownerId, false, false);
  await requireEditorAccess(ctx, ownerId);
  const ids = [...new Set(args.fileIds)];
  if (!ids.length || ids.length > 20) throw new ConvexError('Choose between 1 and 20 files');
  let added = 0, existing = 0;
  for (const id of ids) {
    const row = await ownedFile(ctx, ownerId, id);
    if (row.kind === 'export') throw new ConvexError('An export cannot be added to a project. Download it and upload it as footage.');
    const refs = await ownedObjectReferences(ctx, ownerId, row), owned = refs.attachments.filter(asset => asset.ownerId === ownerId);
    if (owned.some(asset => asset.projectId === project._id)) { existing++; continue; }
    // An attachment in a live project is copied the way the editor copies media between projects.
    let source: Doc<'assets'> | undefined;
    for (const asset of owned) { const home = await ctx.db.get(asset.projectId); if (home && !home.deleting && home.ownerId === ownerId) { source = asset; break; } }
    if (source) {
      const tasks = await ctx.db.query('mediaTasks').withIndex('by_asset_kind', q => q.eq('assetId', source._id)).order('desc').take(50);
      if (tasks.some(task => ['queued', 'running', 'retrying'].includes(task.status))) throw new ConvexError(`${row.fileName} is still being prepared in its project. Add it once that finishes.`);
      const [copy] = await copyMediaFor(ctx, ownerId, project._id, [source._id]);
      if (copy.copied) { added++; if (source.fileName !== row.fileName) await ctx.db.patch(copy.assetId, { fileName: row.fileName }); } else existing++;
      continue;
    }
    const library = refs.library?.ownerId === ownerId && refs.library.completed && !refs.library.aborting ? refs.library : null;
    if (!library) throw new ConvexError(`${row.fileName} is no longer available`);
    const inProject = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', ownerId).eq('projectId', project._id)).take(PROJECT_MEDIA_LIMIT + 1);
    if (inProject.length >= PROJECT_MEDIA_LIMIT) throw new ConvexError(`A project supports up to ${PROJECT_MEDIA_LIMIT} media files`);
    const preparation = uploadPreparationTasks(library.kind);
    if (preparation) await requireMediaTaskCapacity(ctx, ownerId, preparation);
    const { r2Key, contentType, kind, size, duration, width, height } = library;
    const assetId = await ctx.db.insert('assets', { ownerId, projectId: project._id, r2Key, fileName: row.fileName, contentType, kind, size, duration, width, height, createdAt: Date.now() });
    if (kind !== 'image') {
      await enqueueMediaTask(ctx, { ownerId, projectId: project._id, assetId, kind: kind === 'video' ? 'extract' : 'waveform' });
      await enqueueMediaTask(ctx, { ownerId, projectId: project._id, assetId, kind: kind === 'video' ? 'preview' : 'transcribe' });
    }
    await recordAssetStorage(ctx, (await ctx.db.get(assetId))!);
    added++;
  }
  return { added, existing };
} });
