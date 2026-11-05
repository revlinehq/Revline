'use node';

import { Buffer } from 'node:buffer';
import { Environment, SignedDataVerifier, VerificationException, VerificationStatus, type JWSTransactionDecodedPayload, type JWSRenewalInfoDecodedPayload } from '@apple/app-store-server-library';
import { ConvexError, v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { appleModelPayment, appleBillingConfiguration, appleEnvironmentAllowed, appleProductPlan } from './lib/apple_entitlements';
import { APPLE_ROOT_CERTIFICATES } from './lib/apple_roots';

function verifier(environment: 'Sandbox' | 'Production' = appleBillingConfiguration().environment) {
  const config = appleBillingConfiguration();
  const appAppleId = process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined;
  if (environment === 'Production' && (!appAppleId || !Number.isSafeInteger(appAppleId))) throw new Error('APPLE_APP_ID is required for production');
  return new SignedDataVerifier(APPLE_ROOT_CERTIFICATES.map(cert => Buffer.from(cert, 'base64')), true,
    environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX, config.bundleId, environment === 'Production' ? appAppleId : undefined);
}

async function verifyForEnvironment<T>(operation: (verification: SignedDataVerifier) => Promise<T>) {
  try { return await operation(verifier()); }
  catch (error) {
    if (!(error instanceof VerificationException) || appleBillingConfiguration().environment !== 'Production' || !process.env.APPLE_SANDBOX_REVIEW_USER_IDS?.trim()) throw error;
    return operation(verifier('Sandbox'));
  }
}

async function persist(ctx: ActionCtx, transaction: JWSTransactionDecodedPayload, details: {
  eventId: string; eventAt?: number; notificationType?: string; renewal?: JWSRenewalInfoDecodedPayload; expectedOwner?: string; forwardBody?: string;
}) {
  const config = appleBillingConfiguration();
  const { transactionId, originalTransactionId, productId, expiresDate, purchaseDate, signedDate } = transaction;
  if (!transactionId || !originalTransactionId || !productId || !expiresDate || !purchaseDate || !signedDate ||
      transaction.bundleId !== config.bundleId || transaction.type !== 'Auto-Renewable Subscription') {
    throw new ConvexError('Invalid App Store subscription transaction');
  }
  if (details.renewal?.originalTransactionId && details.renewal.originalTransactionId !== originalTransactionId) throw new ConvexError('Renewal does not match the transaction');
  const ownerId = await ctx.runQuery(internal.appleBilling.owner, { token: transaction.appAccountToken, originalTransactionId });
  if (!ownerId || (details.expectedOwner && ownerId !== details.expectedOwner)) throw new ConvexError('This purchase is not linked to your Revline account');
  const environment = transaction.environment;
  if ((environment !== 'Sandbox' && environment !== 'Production') || !appleEnvironmentAllowed(ownerId, environment)) throw new ConvexError('This App Store environment is not allowed for this account');
  const eventAt = details.eventAt ?? signedDate;
  const revokedAt = transaction.revocationDate ?? (['REFUND', 'REVOKE'].includes(details.notificationType ?? '') ? eventAt : undefined);
  const graceUntil = details.renewal?.gracePeriodExpiresDate;
  const expired = ['EXPIRED', 'GRACE_PERIOD_EXPIRED'].includes(details.notificationType ?? '');
  await ctx.runMutation(internal.appleBilling.apply, {
    source: 'apple', eventId: details.eventId, ownerId, transactionId, originalTransactionId, productId,
    modelPayment: appleModelPayment(transaction),
    plan: appleProductPlan(productId), environment, purchasedAt: purchaseDate, expiresAt: expiresDate,
    accessUntil: revokedAt ? 0 : Math.max(expiresDate, expired ? 0 : graceUntil ?? 0), eventAt,
    ...(transaction.isUpgraded ? { supersededAt: purchaseDate } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(details.notificationType === 'REFUND_REVERSED' ? { refundReversed: true } : {}),
    ...(details.renewal?.autoRenewStatus !== undefined ? { autoRenew: details.renewal.autoRenewStatus === 1 } : {}),
    ...(details.renewal?.isInBillingRetryPeriod !== undefined ? { billingIssue: details.renewal.isInBillingRetryPeriod } : {}),
    ...(details.forwardBody ? { forwardBody: details.forwardBody } : {}),
  });
}

/** The native client submits StoreKit's original JWS, never client-derived entitlements. */
export const syncTransaction = action({ args: { signedTransaction: v.string() }, returns: v.null(), handler: async (ctx, { signedTransaction }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError('Authentication required');
  if (signedTransaction.length > 100_000) throw new ConvexError('Transaction is too large');
  const transaction = await verifyForEnvironment(verification => verification.verifyAndDecodeTransaction(signedTransaction));
  await persist(ctx, transaction, { expectedOwner: identity.subject, eventId: `transaction:${transaction.transactionId}:${transaction.signedDate}` });
  return null;
} });

const notificationInput = z.object({ signedPayload: z.string().min(1).max(200_000) });
export const notification = internalAction({ args: { body: v.string() }, returns: v.number(), handler: async (ctx, { body }) => {
  let verification: SignedDataVerifier;
  try { verification = verifier(); } catch { return 503; }
  const input = notificationInput.safeParse(JSON.parse(body));
  if (!input.success) return 400;
  try {
    const payload = await verifyForEnvironment(candidate => candidate.verifyAndDecodeNotification(input.data.signedPayload));
    if (payload.notificationType === 'TEST') return 200;
    if (!payload.data?.signedTransactionInfo || !payload.notificationUUID || !payload.signedDate) return 200;
    if (payload.data.environment !== 'Sandbox' && payload.data.environment !== 'Production') return 400;
    verification = verifier(payload.data.environment);
    const transaction = await verification.verifyAndDecodeTransaction(payload.data.signedTransactionInfo);
    const renewal = payload.data.signedRenewalInfo ? await verification.verifyAndDecodeRenewalInfo(payload.data.signedRenewalInfo) : undefined;
    await persist(ctx, transaction, { eventId: payload.notificationUUID, eventAt: payload.signedDate,
      notificationType: payload.notificationType, renewal, forwardBody: body });
    return 200;
  } catch (error) {
    if (error instanceof VerificationException) return error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE ? 503 : 400;
    // An unknown appAccountToken can precede the authenticated purchase sync. Ask Apple to retry.
    if (error instanceof ConvexError) return 503;
    throw error;
  }
} });
