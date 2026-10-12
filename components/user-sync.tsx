'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/** Repair an authenticated profile without waiting for Clerk webhook delivery. */
export function UserSync() {
  const { userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    void store({}).catch(() => { console.error('Could not synchronize the signed-in profile.'); });
  }, [isAuthenticated, store, userId]);
  return null;
}
