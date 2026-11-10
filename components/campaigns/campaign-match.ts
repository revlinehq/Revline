'use client';
// Matching what the user sends in a project against stored campaigns, in the background. It never blocks or
// fails an edit: a clear match is attached (the chip then shows it), an unclear one is offered as choices.
import { useCallback, useSyncExternalStore } from 'react';
import { useAction, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { CampaignView } from '@/convex/campaignsModel';

// Campaigns offered for a project, until one is picked or the offer is dismissed. Per tab, not stored.
const offers = new Map<string, CampaignView[]>();
const listeners = new Set<() => void>();
const NONE: CampaignView[] = [];
const attempts = new Map<string, number>();
const MAX_ATTEMPTS = 8;
function setOffer(projectId: string, choices: CampaignView[]) {
  if (choices.length) offers.set(projectId, choices); else offers.delete(projectId);
  for (const listener of listeners) listener();
}
export const dismissCampaignOffer = (projectId: string) => setOffer(projectId, NONE);
export function useCampaignOffer(projectId: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => offers.get(projectId) ?? NONE, () => NONE);
}

/** Returns a function to call with text the user sent. It does nothing once the project has a campaign or the user removed one. */
export function useCampaignMatcher(projectId: Id<'projects'>) {
  const link = useQuery(api.campaigns.forProject, { projectId });
  const match = useAction(api.campaignsSearch.matchProject);
  const settled = !link || !!link.campaign || link.declined;
  return useCallback((text: string) => {
    // Briefs arrive early in a project; after a few messages that named no campaign, stop asking for this tab.
    const tried = attempts.get(projectId) ?? 0;
    if (settled || text.trim().length < 8 || tried >= MAX_ATTEMPTS) return;
    attempts.set(projectId, tried + 1);
    void match({ projectId, text: text.slice(0, 20_000) })
      .then(result => { if (result.status === 'choices') setOffer(projectId, result.choices); })
      .catch(() => { /* matching is a convenience; the edit goes on without it */ });
  }, [match, projectId, settled]);
}
