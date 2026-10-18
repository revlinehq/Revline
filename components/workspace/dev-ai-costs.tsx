'use client';

import { useState } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { AiCostReportView } from './ai-cost-report';
import { DevOpenAiCosts } from './dev-openai-costs';

// Keep the query-owning component unmounted in production, including signed-in profiles.
export function DevAiCosts() {
  return process.env.NODE_ENV !== 'production' ? <ConnectedAiCosts /> : null;
}

function ConnectedAiCosts() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [days, setDays] = useState<7 | 30>(7);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const report = useQuery(api.aiCosts.summary, isAuthenticated ? { days, timeZone } : 'skip');
  if (!isAuthenticated && !isLoading) return null;
  return <>{isAuthenticated && <DevOpenAiCosts days={days} />}<AiCostReportView report={report} days={days} onDaysChange={setDays} loading={isLoading || report === undefined} /></>;
}
