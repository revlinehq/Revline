import { SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';
import type { SignInFutureResource, SignUpFutureResource } from '@clerk/shared/types';

type EmailSignIn = Pick<SignInFutureResource, 'create' | 'emailCode' | 'status'>;
type EmailSignUp = Pick<SignUpFutureResource, 'create' | 'status'>;

/** Shared sign-in-or-up flow from ViralShark, using Clerk's v7 resources. */
export async function sendEmailCode(signIn: EmailSignIn, email: string) {
  const created = await signIn.create({ identifier: email, signUpIfMissing: true });
  if (created.error) throw created.error;
  const sent = await signIn.emailCode.sendCode();
  if (sent.error) throw sent.error;
}

function isSignUpTransfer(error: unknown) {
  const value = error as { code?: string; errors?: { code?: string }[] } | null;
  return value?.code === 'sign_up_if_missing_transfer' || value?.errors?.some(item => item.code === 'sign_up_if_missing_transfer') === true;
}

function isComplete(attempt: { status: string | null }) {
  return attempt.status === 'complete';
}

export async function verifyEmailCode(signIn: EmailSignIn, signUp: EmailSignUp, code: string): Promise<'signIn' | 'signUp'> {
  // Finalization can be retried without consuming an already verified code again.
  if (isComplete(signIn)) return 'signIn';
  if (isComplete(signUp)) return 'signUp';
  const verified = await signIn.emailCode.verifyCode({ code });
  if (isSignUpTransfer(verified.error)) {
    const transferred = await signUp.create({ transfer: true });
    if (transferred.error) throw transferred.error;
    if (isComplete(signUp)) return 'signUp';
    throw new Error('Your email is verified, but your account needs more information. Please contact support.');
  }
  if (verified.error) throw verified.error;
  if (!isComplete(signIn)) throw new Error('Your account needs another verification step. Please use another sign-in method.');
  return 'signIn';
}

export function safeAuthRedirect(value: string | null | undefined, origin: string): string {
  if (!value) return SIGNED_IN_HOME_PATH;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || /^\/(?:sign-in|sign-up|sso-callback)(?:\/|$)/.test(url.pathname)) return SIGNED_IN_HOME_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return SIGNED_IN_HOME_PATH; }
}
