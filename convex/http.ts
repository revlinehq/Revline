import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerRoutes } from "@convex-dev/stripe";
import { components, internal } from "./_generated/api";
const http = httpRouter();
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
http.route({ path: "/uploads", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers })) });
http.route({ path: "/uploads", method: "POST", handler: httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("ticket");
  if (!token) return new Response(JSON.stringify({ error: "Missing upload ticket" }), { status: 400, headers });
  let storageId;
  try {
    const reservation = await ctx.runMutation(internal.uploads.reserve, { token });
    const contentType = request.headers.get("Content-Type")?.split(";")[0];
    if (!contentType || !(reservation.render ? contentType === "video/mp4" : /^(video|audio|image)\//.test(contentType))) throw new Error("Choose a supported media file");
    const blob = await request.blob();
    if (blob.size === 0 || blob.size > 100 * 1024 * 1024) throw new Error("Files must be between 1 byte and 100 MB");
    storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.uploads.finish, { ticketId: reservation.ticketId, storageId });
    return new Response(JSON.stringify({ storageId }), { headers });
  } catch {
    if (storageId) await ctx.storage.delete(storageId);
    return new Response(JSON.stringify({ error: "Upload failed. Request a new upload URL and retry." }), { status: 400, headers });
  }
}) });
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
  registerRoutes(http, components.stripe, { webhookPath: "/stripe/webhook" });
} else {
  http.route({ path: "/stripe/webhook", method: "POST", handler: httpAction(async () => new Response("Billing is not active", { status: 503 })) });
}
export default http;
