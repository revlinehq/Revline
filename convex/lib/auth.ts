import { readProject } from './project_data';
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DatabaseContext = QueryCtx | MutationCtx;

export async function requireOwner(ctx: DatabaseContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  const deletion=await ctx.db.query('accountDeletions').withIndex('by_owner',q=>q.eq('ownerId',identity.subject)).unique();
  if(deletion)throw new ConvexError('This account is being deleted.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity.subject))),b=>b.toString(16).padStart(2,'0')).join('');
  const removed=await ctx.db.query('deletedAccountTokens').withIndex('by_hash',q=>q.eq('subjectHash',hash)).unique();
  if(removed&&removed.expiresAt>Date.now())throw new ConvexError('This account was deleted.');
  return identity.subject;
}

export async function requireProject(
  ctx: DatabaseContext,
  projectId: Id<"projects">,
  ownerId: string,
  /** Undo history is up to 10 full timelines; load it only where it is read. */
  includeHistory = false,
) {
  const project = await readProject(ctx,projectId,includeHistory);
  if (!project || project.deleting || project.ownerId !== ownerId) {
    throw new ConvexError("Project not found");
  }
  return project;
}

export function listLimit(limit: number | undefined) {
  const value = limit ?? 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ConvexError("Limit must be an integer between 1 and 100");
  }
  return value;
}
