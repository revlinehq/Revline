import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export type Folder = Doc<'storageFolders'>;
type Context = MutationCtx | QueryCtx;
/** An account's folders are loaded whole for tree checks, so their number is bounded. */
export const MAX_FOLDERS = 500;
/** Nesting levels below the root. */
export const MAX_FOLDER_DEPTH = 8;

/** Every live folder of one owner, keyed by ID. */
export async function ownerFolders(ctx: Context, ownerId: string) {
  const rows = await ctx.db.query('storageFolders').withIndex('by_owner_parent', q => q.eq('ownerId', ownerId)).take(MAX_FOLDERS + 100);
  return new Map(rows.filter(row => !row.deleting).map(row => [row._id, row]));
}
export async function ownedFolder(ctx: Context, ownerId: string, folderId: Id<'storageFolders'>) {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.ownerId !== ownerId || folder.deleting) throw new ConvexError('Folder not found');
  return folder;
}
/** The folder and its ancestors, nearest first. Stops at a missing parent or a loop. */
export function lineage(folders: Map<Id<'storageFolders'>, Folder>, folderId: Id<'storageFolders'> | undefined) {
  const path: Folder[] = [], seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id); id = folders.get(id)?.parentId) {
    const folder = folders.get(id); if (!folder) break;
    seen.add(id); path.push(folder);
  }
  return path;
}
export function folderName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) throw new ConvexError('A folder name needs between 1 and 80 characters');
  return name;
}
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
export function siblingNames(folders: Map<Id<'storageFolders'>, Folder>, parentId: Id<'storageFolders'> | undefined, except?: Id<'storageFolders'>) {
  return [...folders.values()].filter(folder => folder.parentId === parentId && folder._id !== except).map(folder => folder.name);
}
export function requireFreeName(names: string[], name: string) {
  if (names.some(other => sameName(other, name))) throw new ConvexError(`A folder named “${name}” already exists here`);
}
/** `name`, or `name (2)`, `name (3)`… when a sibling already has it. */
export function freeName(names: string[], name: string) {
  if (!names.some(other => sameName(other, name))) return name;
  for (let n = 2; ; n++) { const next = `${name.slice(0, 74)} (${n})`; if (!names.some(other => sameName(other, next))) return next; }
}
/** Adds a change in finished files to a folder and every folder above it. */
export async function adjustFolderTotals(ctx: MutationCtx, folderId: Id<'storageFolders'> | undefined, files: number, bytes: number) {
  if (!files && !bytes) return;
  const seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id);) {
    const folder: Folder | null = await ctx.db.get(id); if (!folder) break;
    seen.add(id);
    await ctx.db.patch(folder._id, { fileCount: Math.max(0, folder.fileCount + files), totalBytes: Math.max(0, folder.totalBytes + bytes) });
    id = folder.parentId;
  }
}
/** Where a file recorded for `folderId` belongs now: that folder, the parent taking over a folder being deleted, or the root. */
export async function liveFolderId(ctx: Context, ownerId: string, folderId: Id<'storageFolders'> | undefined) {
  const seen = new Set<string>();
  for (let id = folderId; id && !seen.has(id);) {
    const folder: Folder | null = await ctx.db.get(id);
    if (!folder || folder.ownerId !== ownerId) return undefined;
    if (!folder.deleting) return folder._id;
    seen.add(id); id = folder.parentId;
  }
  return undefined;
}
