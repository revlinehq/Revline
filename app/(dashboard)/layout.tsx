import type { ReactNode } from 'react';
import { SignedOutRedirect } from '@/components/auth/signed-out-redirect';

/**
 * Every signed-in page. proxy.ts sends signed-out visitors to sign-in before a page renders, so nothing here reads
 * the request and the pages stay static; SignedOutRedirect is the same rule in the browser.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <><SignedOutRedirect />{children}</>;
}
