'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAction, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import '@/components/dashboard/dash-list.css';

// A code can be exchanged once; development renders effects twice, so each state is sent a single time.
const sent = new Set<string>();

/** Where a platform returns the user after its consent screen. Finishes the connection as the signed-in user. */
export function ConnectCallback({ code, state, refused }: { code?: string; state?: string; refused: boolean }) {
  const router = useRouter(), { isAuthenticated } = useConvexAuth(), finishConnect = useAction(api.postingActions.finishConnect);
  const invalid = !code || !state || code.length > 4096 || state.length > 512;
  const [error, setError] = useState(invalid ? refused ? 'The connection was cancelled.' : 'This connection link is not valid. Start again from Connected accounts.' : '');
  useEffect(() => {
    if (invalid || !isAuthenticated || sent.has(state)) return;
    sent.add(state);
    finishConnect({ code, state }).then(result => {
      if (result.ok) router.replace(`/accounts?connected=${result.platform ?? ''}`);
      else setError(result.error ?? 'Could not connect this account.');
    }, reason => setError(userError(reason, 'Could not connect this account.')));
  }, [invalid, isAuthenticated, code, state, finishConnect, router]);
  return <main className="dash-content"><div className="dash-column"><div className="dash-empty" role={error ? 'alert' : 'status'}>
    {error ? <><h2>This account was not connected</h2><p>{error}</p><Button asChild variant="soft" className="mt-3"><Link href="/accounts">Back to connected accounts</Link></Button></> : <p>Connecting your account…</p>}
  </div></div></main>;
}
