import { readProject } from './project_data';
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DatabaseContext = QueryCtx | MutationCtx;

export async function requireOwner(ctx: DatabaseContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return identity.subject;
}

export async function requireProject(
  ctx: DatabaseContext,
  projectId: Id<"projects">,
  ownerId: string,
  includeHistory = true,
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
