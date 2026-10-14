import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireEditorAccess } from './lib/billing_access';

export async function issueUpload(ctx: MutationCtx, ownerId: string, projectId: Id<"projects">, jobId?: Id<"renderJobs">) {
  const pending = await ctx.db.query("uploadTickets").withIndex("by_projectId", q => q.eq("projectId", projectId)).take(101);
  let active = 0;
  for (const ticket of pending) {
    if (ticket.expiresAt <= Date.now()) {
      if (ticket.storageId && !ticket.consumed) await ctx.storage.delete(ticket.storageId);
      await ctx.db.delete(ticket._id);
    } else active++;
  }
  if (active >= 100) throw new ConvexError("Finish existing uploads before requesting more upload URLs");
  // Convex supplies a cryptographically unguessable upload URL as the bearer token.
  // Files pass through our HTTP action so the resulting storage ID is bound to its owner.
  const token = await ctx.storage.generateUploadUrl();
  await ctx.db.insert("uploadTickets", { token, ownerId, projectId, ...(jobId ? { jobId } : {}), expiresAt: Date.now() + 15 * 60 * 1000, consumed: false });
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new ConvexError("Upload endpoint is not configured");
  return `${site}/uploads?ticket=${encodeURIComponent(token)}`;
}
export const reserve = internalMutation({ args: { token: v.string() }, returns: v.object({ ticketId: v.id("uploadTickets"), render: v.boolean() }), handler: async (ctx, args) => {
  const ticket = await ctx.db.query("uploadTickets").withIndex("by_token", q => q.eq("token", args.token)).unique();
  if (!ticket || ticket.consumed || ticket.receiving || ticket.storageId || ticket.expiresAt < Date.now()) throw new ConvexError("Upload ticket expired or was already used");
  const project = await ctx.db.get(ticket.projectId);
  if (!project || project.ownerId !== ticket.ownerId) throw new ConvexError("Project not found");
  if (!ticket.jobId) await requireEditorAccess(ctx, ticket.ownerId);
  if (ticket.jobId) { const job = await ctx.db.get(ticket.jobId); if (!job || job.ownerId !== ticket.ownerId || job.status !== "rendering") throw new ConvexError("Render is not accepting an upload"); }
  await ctx.db.patch(ticket._id, { receiving: true });
  return { ticketId: ticket._id, render: !!ticket.jobId };
}});
export const finish = internalMutation({ args: { ticketId: v.id("uploadTickets"), storageId: v.id("_storage") }, returns: v.null(), handler: async (ctx, args) => {
  const ticket = await ctx.db.get(args.ticketId);
  if (!ticket || !ticket.receiving || ticket.consumed || ticket.storageId) throw new ConvexError("Upload ticket already used");
  if (!ticket.jobId) await requireEditorAccess(ctx, ticket.ownerId);
  await ctx.db.patch(ticket._id, { storageId: args.storageId, receiving: false }); return null;
}});
export async function consumeUpload(ctx: MutationCtx, storageId: Id<"_storage">, ownerId: string, projectId: Id<"projects">, jobId?: Id<"renderJobs">) {
  const ticket = await ctx.db.query("uploadTickets").withIndex("by_storageId", q => q.eq("storageId", storageId)).unique();
  if (!ticket || ticket.consumed || ticket.ownerId !== ownerId || ticket.projectId !== projectId || ticket.jobId !== jobId || ticket.expiresAt < Date.now()) throw new ConvexError("Uploaded file does not belong to this request");
  await ctx.db.delete(ticket._id);
}
