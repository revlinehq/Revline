'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';

export type PlanStatus = FunctionReturnType<typeof api.billing.status>;
const cacheKey = (userId: string) => `revline:plan-status:${userId}`;

/** The live plan status, falling back to this account's last known one while Convex
 *  confirms the sign-in. Display only: the server re-checks access on every edit and export. */
export function usePlanStatus(): PlanStatus | undefined {
  const { userId } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const live = useQuery(api.billing.status, isAuthenticated ? {} : 'skip');
  const [cached, setCached] = useState<{ userId: string; status: PlanStatus }>();
  useEffect(() => {
    if (!userId) return;
    try { const stored = localStorage.getItem(cacheKey(userId)); if (stored) setCached({ userId, status: JSON.parse(stored) }); } catch {}
  }, [userId]);
  useEffect(() => {
    if (!userId || !live) return;
    try { localStorage.setItem(cacheKey(userId), JSON.stringify(live)); } catch {}
  }, [userId, live]);
  return live ?? (cached && cached.userId === userId ? cached.status : undefined);
}
