import { serve as servePixelTrack } from './pixelTracks';
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { processEvent } from "@convex-dev/stripe";
import Stripe from 'stripe';
import { api, components, internal } from "./_generated/api";
import { registerAlertWebhooks } from './alertWebhooks';
import { registerMcpRoutes } from './mcpHttp';
import { prepare as prepareMcpUpload } from './mcpUploads';
import { registerAgentRunnerRoutes } from './agentRunnerHttp';
import { registerMcpBridgeRoutes } from './mcpBridgeHttp';
import { registerAppleBillingRoutes } from './appleBillingHttp';
import { discordWebhookUrl } from './lib/discord_alert';
import { fromStripeSubscription, isEditorSubscription } from './lib/billing_access';
type HttpCtx = Parameters<Parameters<typeof httpAction>[0]>[0];
/** Reconcile CURRENT Stripe state, never an old event snapshot. The sync token also prevents concurrent reads from
 *  applying in reverse order, and an event already applied to this subscription is skipped. */
async function syncSubscription(ctx: HttpCtx, stripe: Stripe, stripeSubscriptionId: string, eventId: string) {
  const token = await ctx.runMutation(internal.billing.beginSubscriptionSync, { stripeSubscriptionId, eventId });
  if (token === null) return;
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = subscription.items.data[0];
  if (subscription.id !== stripeSubscriptionId) throw new Error('Invalid subscription response');
  await ctx.runMutation(internal.billing.applySubscriptionSync, {
    stripeSubscriptionId, eventId, token,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    status: subscription.status, currentPeriodEnd: item?.current_period_end ?? 0,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    cancelAt: subscription.cancel_at ?? undefined, quantity: item?.quantity ?? 1,
    // The price's lookup key names the plan, so a price changed in the portal or dashboard still reads right.
    ...fromStripeSubscription(subscription),
  });
}
const ENDED = ['canceled', 'incomplete_expired'];
/** A disputed charge ends every Revline subscription of that customer now; a fully refunded subscription invoice
 *  ends that subscription now when it was the latest invoice. Both read current Stripe state, so a redelivered event finds nothing left to cancel;
 *  the cancel itself carries an idempotency key per event and subscription. */
async function revokeForChargeback(ctx: HttpCtx, stripe: Stripe, event: Stripe.Event) {
  const ids = new Set<string>();
  if (event.type === 'charge.dispute.created') {
    const { charge: chargeRef } = event.data.object as Stripe.Dispute;
    const charge = await stripe.charges.retrieve(typeof chargeRef === 'string' ? chargeRef : chargeRef.id);
    const customer = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
    if (!customer) return;
    const remote = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
    for (const sub of remote.data) if (!ENDED.includes(sub.status) && isEditorSubscription(fromStripeSubscription(sub))) ids.add(sub.id);
  } else {
    const charge = await stripe.charges.retrieve((event.data.object as Stripe.Charge).id);
    if (!charge.refunded || charge.amount_refunded < charge.amount) return;
    const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntent) return;
    const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntent }, expand: ['data.invoice'], limit: 10 });
    for (const payment of payments.data) {
      const invoice = payment.invoice;
      if (typeof invoice === 'string' || invoice.deleted) continue;
      const ref = invoice.parent?.subscription_details?.subscription;
      if (!ref) continue;
      const sub = typeof ref === 'string' ? await stripe.subscriptions.retrieve(ref) : ref;
      // Only the invoice for the period being paid for: refunding an old period (goodwill) leaves the current one alone.
      const latest = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
      if (latest !== invoice.id) continue;
      if (!ENDED.includes(sub.status) && isEditorSubscription(fromStripeSubscription(sub))) ids.add(sub.id);
    }
  }
  for (const id of ids) {
    await stripe.subscriptions.cancel(id, { prorate: false }, { idempotencyKey: `revline-revoke:${event.id}:${id}` });
    console.info('Stripe subscription ended after a chargeback', { eventId: event.id, type: event.type });
    await syncSubscription(ctx, stripe, id, event.id);
  }
}
const http = httpRouter();
http.route({ path: '/pixel-track', method: 'GET', handler: servePixelTrack });
registerAlertWebhooks(http);
registerMcpRoutes(http);
http.route({ path: '/mcp/upload', method: 'POST', handler: prepareMcpUpload });
registerAgentRunnerRoutes(http);
registerMcpBridgeRoutes(http);
registerAppleBillingRoutes(http);
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
// A shared timeline's link preview image (Open Graph / X card), 1200x630 JPEG.
http.route({ path: "/share-card", method: "GET", handler: httpAction(async (ctx, request) => {
  const shareId = new URL(request.url).searchParams.get("share") ?? "";
  const image = shareId ? await ctx.runQuery(api.timelineShares.cardImage, { shareId }) : null;
  if (!image) return new Response("Not found", { status: 404 });
  if (image.startsWith('https://')) return Response.redirect(image, 302);
  const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" } });
}) });
http.route({ path: "/uploads", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers })) });
const storeUpload = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("ticket");
  if (!token) return new Response(JSON.stringify({ error: "Missing upload ticket" }), { status: 400, headers });
  let storageId;
  try {
    const reservation = await ctx.runMutation(internal.uploads.reserve, { token });
    const contentType = request.headers.get("Content-Type")?.split(";")[0];
    if (!contentType || !/^(?:(video|audio|image)\/|model\/gltf-binary$)/.test(contentType)) throw new Error("Choose a supported media file");
    const blob = await request.blob();
    if (blob.size === 0 || blob.size > 100 * 1024 * 1024) throw new Error("Files must be between 1 byte and 100 MB");
    storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.uploads.finish, { ticketId: reservation.ticketId, storageId });
    return new Response(JSON.stringify({ storageId }), { headers });
  } catch {
    if (storageId) await ctx.storage.delete(storageId);
    return new Response(JSON.stringify({ error: "Upload failed. Request a new upload URL and retry." }), { status: 400, headers });
  }
});
http.route({ path: "/uploads", method: "POST", handler: storeUpload });
// The same ticketed upload under the MCP server's public address, for the uploadMedia model script (mcpUploads.ts).
http.route({ path: "/mcp/upload/model", method: "POST", handler: storeUpload });
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
  http.route({ path: '/stripe/webhook', method: 'POST', handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get('stripe-signature');
    if (!signature) return new Response('Missing signature', { status: 400 });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch {
      return new Response('Invalid webhook signature', { status: 400 });
    }
    try {
      if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
        await syncSubscription(ctx, stripe, (event.data.object as Stripe.Subscription).id, event.id);
      } else {
        await processEvent(ctx, components.stripe, event, stripe);
        if (event.type === 'charge.dispute.created' || event.type === 'charge.refunded') await revokeForChargeback(ctx, stripe, event);
      }
    } catch {
      // No Stripe payloads, customer details or signing errors in public output.
      console.error('Stripe webhook reconciliation failed', { eventId: event.id, type: event.type });
      return new Response('Webhook processing failed', { status: 500 });
    }
    // Discord is an independent, optional sink. It must never break payment reconciliation.
    if (discordWebhookUrl('stripe') && ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created'].includes(event.type)) {
      try {
        const objectId = 'id' in event.data.object ? event.data.object.id : 'unavailable';
        await ctx.runMutation(internal.discordAlerts.enqueue, { source: 'stripe', eventId: event.id, title: `Stripe: ${event.type}`, description: `Event: ${event.id}\nObject: ${objectId}\nMode: ${event.livemode ? 'live' : 'test'}` });
      } catch { console.error('Stripe notification could not be queued', { eventId: event.id }); }
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  }) });
} else {
  http.route({ path: "/stripe/webhook", method: "POST", handler: httpAction(async () => new Response("Billing is not active", { status: 503 })) });
}

export default http;
