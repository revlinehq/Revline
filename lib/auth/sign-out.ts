import type { useClerk } from '@clerk/nextjs';

/** Ends the session, then loads the sign-in page in full. Clerk's own redirect is a
 * client-side push that can leave the current page rendered signed out (as the demo
 * workspace); a document load also drops every cached signed-in query. */
export async function signOutToSignIn(clerk: ReturnType<typeof useClerk>) {
  await clerk.signOut({ redirectUrl: '/sign-in' });
  window.location.replace('/sign-in');
}
