import type { Metadata } from 'next';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Data deletion request | Revline', robots: { index: false } };
// Read at each visit: the request moves from received to completed.
export const dynamic = 'force-dynamic';

/**
 * Where Instagram sends a person who asked for the data Revline holds about their account to be deleted
 * (convex/postingCallbacks.ts). The confirmation code in the address is all it knows: it shows the state of that
 * request and nothing about the person or the account.
 */
export default async function DataDeletionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params, convex = process.env.NEXT_PUBLIC_CONVEX_URL;
  const status = convex ? await new ConvexHttpClient(convex).query(api.postingCallbacks.deletionStatus, { code }).catch(() => undefined) : undefined;
  return <LegalPage title="Data deletion request" description="The status of a request, made through Instagram, to delete the data Revline holds about an Instagram account.">
    {status === undefined ? <section><h2>Status unavailable</h2><p>The status could not be read right now. Open this page again in a moment.</p></section>
      : status === null ? <section><h2>Request not found</h2><p>No deletion request has this confirmation code. Check that the address is the one Instagram gave you.</p></section>
      : <>
        <section>
          <h2>{status === 'completed' ? 'Completed' : 'Received'}</h2>
          <p>{status === 'completed'
            ? 'The deletion is complete. Revline no longer holds data from this Instagram account.'
            : 'Revline received the request. The connection to the Instagram account, its access tokens and its profile details are already deleted; what Instagram gave for individual posts is being removed now. This page will read Completed when that is done, usually within a minute.'}</p>
          <p>Confirmation code: <code>{code}</code></p>
        </section>
        <section>
          <h2>What is deleted</h2>
          <p>The connection to the Instagram account in every Revline workspace that had connected it: the access tokens, the account’s Instagram IDs, username, name, and profile picture. For posts Revline published to that account, the Instagram post ID, link and statistics are removed.</p>
          <p>The Revline user’s own record of those posts stays in their workspace: the video they exported and the caption and title they wrote. It no longer names the Instagram account. Posts already published on Instagram are not removed from Instagram.</p>
        </section>
      </>}
  </LegalPage>;
}
