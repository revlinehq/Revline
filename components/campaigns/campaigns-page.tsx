'use client';
// Campaigns: All (search, Popular now, More campaigns) and Mine (the user's saved campaigns), one card for both.
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { CampaignView } from '@/convex/campaignsModel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/segmented';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { EditComposer } from '@/components/workspace/edit-composer';
import { CampaignCard } from './campaign-card';
import { timeAgo } from './campaign-format';
import { useNow } from './use-now';
import './campaigns.css';

export type CampaignsView = 'all' | 'mine';
const VIEWS = [{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }] as const;
/** Cards in "More campaigns" before "See all". */
const MORE_PREVIEW = 8;

function Section({ title, expanded, onToggle, children }: { title: string; expanded?: boolean; onToggle?: () => void; children: React.ReactNode }) {
  return <section className="campaigns-section">
    <div className="campaigns-section-head"><h2>{title}</h2>{onToggle && <Button variant="ghost" size="sm" className="campaigns-see-all" onClick={onToggle} aria-expanded={expanded}>{expanded ? 'Show less' : 'See all'}</Button>}</div>
    {children}
  </section>;
}

/** A grid of campaign cards, still, while the campaigns load; `titled` adds the section name's placeholder. */
export function CampaignCardsSkeleton({ label, titled }: { label: string; titled?: boolean }) {
  return <div className="campaigns-section" role="status" aria-label={label}>
    {titled && <div className="campaigns-section-head"><Skeleton className="h-5 w-28" /></div>}
    <div className="campaigns-grid">{Array.from({ length: 8 }, (_, index) => <Card key={index} variant="dash" className="campaign-card">
      <div className="campaign-card-art" /><div className="campaign-card-body"><Skeleton className="h-4 w-3/4" /><Skeleton className="my-1 h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
    </Card>)}</div>
  </div>;
}

function AllCampaigns({ now }: { now: number }) {
  const { isAuthenticated } = useConvexAuth();
  const search = useAction(api.campaignsSearch.search);
  const updatedAt = useQuery(api.campaigns.lastUpdated, isAuthenticated ? {} : 'skip');
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ text: string; campaigns: CampaignView[] } | null>(null);
  const [error, setError] = useState('');
  const [popularOpen, setPopularOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const latest = useRef(0), pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function run(wanted: string) {
    // A search asked for now (Enter, Try again) replaces the one waiting on the typing pause.
    clearTimeout(pending.current);
    const request = ++latest.current;
    setError('');
    try {
      const result = await search({ text: wanted, limit: 50 });
      if (request === latest.current) setFound({ text: wanted, campaigns: result.campaigns.map(entry => entry.campaign) });
    } catch { if (request === latest.current) setError('failed'); }
  }
  // Empty text lists campaigns by hot score; typing searches shortly after the last key.
  const wanted = text.trim();
  useEffect(() => {
    if (!isAuthenticated) return;
    pending.current = setTimeout(() => void run(wanted), wanted ? 350 : 0);
    return () => clearTimeout(pending.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` only reads refs and stable setters
  }, [wanted, isAuthenticated]);

  const campaigns = found?.campaigns;
  const searching = !!found?.text;
  // The hottest third leads as "Popular now"; the rest follow.
  const popularCount = campaigns ? Math.min(6, Math.ceil(campaigns.length / 3)) : 0;
  const popular = campaigns?.slice(0, popularCount) ?? [], more = campaigns?.slice(popularCount) ?? [];
  return <main className="dash-content campaigns-content">
    <h1 className="campaigns-heading">Find a campaign to clip</h1>
    <EditComposer className="campaigns-search" variant="compact" appearance="flat" value={text} onChange={setText} onSubmit={() => run(text.trim())} placeholder="Gaming, podcasts, $2 per 1K views" attachControl={<></>} />
    <p className="campaigns-source">Campaigns from Content Rewards{typeof updatedAt === 'number' && <> · updated {timeAgo(updatedAt, now)}</>}</p>
    {error ? <div className="dash-empty" role="alert"><h2>Could not load campaigns</h2><p>Check your connection and try again.</p><Button variant="soft" onClick={() => void run(wanted)}>Try again</Button></div>
      : !campaigns ? <CampaignCardsSkeleton label="Loading campaigns" titled />
      : !campaigns.length ? <div className="dash-empty"><h2>{searching ? 'No campaigns match' : 'No campaigns yet'}</h2><p>{searching ? 'Try other words, or clear the search to see every campaign.' : 'Campaigns you can clip for will show here.'}</p></div>
      : searching ? <Section title="Results"><div className="campaigns-grid">{campaigns.map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div></Section>
      : <>
        <Section title="Popular now" expanded={popularOpen} onToggle={popular.length > 3 ? () => setPopularOpen(open => !open) : undefined}>
          <div className={popularOpen ? 'campaigns-grid' : 'campaigns-row'}>{popular.map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div>
        </Section>
        {more.length > 0 && <Section title="More campaigns" expanded={moreOpen} onToggle={more.length > MORE_PREVIEW ? () => setMoreOpen(open => !open) : undefined}>
          <div className="campaigns-grid">{(moreOpen ? more : more.slice(0, MORE_PREVIEW)).map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div>
        </Section>}
      </>}
  </main>;
}

function MyCampaigns({ now }: { now: number }) {
  const { isAuthenticated } = useConvexAuth();
  const mine = useQuery(api.campaigns.mine, isAuthenticated ? {} : 'skip');
  return <main className="dash-content campaigns-content">
    <section className="campaigns-section campaigns-mine">
      <div className="campaigns-section-head"><h1>My campaigns</h1></div>
      {!mine ? <CampaignCardsSkeleton label="Loading your campaigns" />
        : !mine.length ? <div className="dash-empty"><h2>Nothing saved yet</h2><p>Save a campaign, or make clips for one, and it shows here.</p></div>
        : <div className="campaigns-grid">{mine.map(entry => <CampaignCard key={entry.campaign._id} campaign={entry.campaign} now={now} />)}</div>}
    </section>
  </main>;
}

/** All or Mine comes from the address (?view=mine), read in the browser so the page itself stays static and the switch never asks the server. */
export function CampaignsPage() {
  const router = useRouter();
  const view: CampaignsView = useSearchParams().get('view') === 'mine' ? 'mine' : 'all';
  const now = useNow();
  return <div className="dash-page">
    <DashboardNavbar title="Campaigns"><Segmented aria-label="Which campaigns to show" value={view} options={VIEWS} onValueChange={next => router.replace(next === 'mine' ? '/campaigns?view=mine' : '/campaigns')} /></DashboardNavbar>
    {view === 'mine' ? <MyCampaigns now={now} /> : <AllCampaigns now={now} />}
  </div>;
}
