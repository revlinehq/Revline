'use client';

import { useState } from 'react';
import { useConvexAuth } from 'convex/react';
import { DevOpenAiCosts } from './dev-openai-costs';

// Keep the query-owning component unmounted in production, including signed-in profiles.
export function DevAiCosts() {
  return process.env.NODE_ENV !== 'production' ? <ConnectedAiCosts /> : null;
}

function ConnectedAiCosts() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [days, setDays] = useState<7 | 30>(7);
  if (!isAuthenticated && !isLoading) return null;
  return isAuthenticated ? <DevOpenAiCosts days={days} onDaysChange={setDays} /> : null;
}
