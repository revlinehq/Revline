'use client';
// Campaigns: All (what Content Rewards features on its Discover page, and search) and Mine (the user's saved
// campaigns), one card for both. Our own hot-score list lives on /campaigns/all.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { CampaignView } from '@/convex/campaignsModel';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { EditComposer } from '@/components/workspace/edit-composer';
import { CampaignCard } from './campaign-card';
import { ClipCard, FeaturedBanner } from './discover-sections';
import { timeAgo } from './campaign-format';
import { useNow } from './use-now';
import './campaigns.css';

export type CampaignsView = 'all' | 'mine';
const VIEWS = [{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }] as const;
/** Cards in "More campaigns" before "See all". */
const MORE_PREVIEW = 8;
/** Cards on the "All campaigns" page; the backend caps one request at this many (convex/campaigns.ts). */
const ALL_LIMIT = 200;

/** Every campaign, on its own page. */
const ALL_PATH = '/campaigns/all';

/** A titled group of cards. "See all" opens the full list on its own page; it never grows the group in place. */
function Section({ title, seeAll, tools, children }: { title: string; seeAll?: boolean; tools?: React.ReactNode; children: React.ReactNode }) {
  return <section className="campaigns-section">
    <div className="campaigns-section-head"><h2>{title}</h2><div className="campaigns-section-tools">{tools}{seeAll && <Button asChild variant="ghost" size="sm" className="campaigns-see-all"><Link href={ALL_PATH}>See all</Link></Button>}</div></div>
    {children}
  </section>;
}

/** One line of cards that scrolls sideways, with arrows for a mouse without a sideways wheel. */
function CardRow({ title, campaigns = [], now, seeAll = true, children }: { title: string; campaigns?: CampaignView[]; now: number; seeAll?: boolean; children?: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const move = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.8, behavior: 'auto' });
  return <Section title={title} seeAll={seeAll} tools={<>
    <Button variant="ghost" size="icon" className="campaigns-row-arrow" aria-label={`Scroll ${title} back`} onClick={() => move(-1)}><ChevronLeft /></Button>
    <Button variant="ghost" size="icon" className="campaigns-row-arrow" aria-label={`Scroll ${title} forward`} onClick={() => move(1)}><ChevronRight /></Button>
  </>}>
    <div ref={row} className="campaigns-row">{children ?? campaigns.map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div>
  </Section>;
}

function AllCampaigns({ now }: { now: number }) {
  const { isAuthenticated } = useConvexAuth();
  const search = useAction(api.campaignsSearch.search);
  const updatedAt = useQuery(api.campaigns.lastUpdated, isAuthenticated ? {} : 'skip');
  const discover = useQuery(api.campaignsDiscover.sections, isAuthenticated ? {} : 'skip');
  // Until the Discover page has been read once there is nothing featured; the hot-score rows stand in.
  const featured = discover && discover.trending.length + discover.fresh.length + discover.searched.length > 0;
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ text: string; campaigns: CampaignView[] } | null>(null);
  const [error, setError] = useState('');
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
  // Typing searches shortly after the last key. Empty text lists campaigns by hot score, only when nothing is featured.
  const wanted = text.trim();
  const listHot = !wanted && featured === false;
  useEffect(() => {
    if (!isAuthenticated) return;
    // Cleared: an answer still on its way, the last results and the last error all belong to the old text.
    if (!wanted && !listHot) { latest.current++; setFound(null); setError(''); return; }
    pending.current = setTimeout(() => void run(wanted), wanted ? 350 : 0);
    return () => clearTimeout(pending.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` only reads refs and stable setters
  }, [wanted, isAuthenticated, listHot]);

  // Results belong to the text they were found for: search results while there is text, the hot-score list without.
  const searching = !!wanted;
  const campaigns = found && !!found.text === searching ? found.campaigns : undefined;
  // The hottest third leads as "Popular now"; the rest follow.
  const popularCount = campaigns ? Math.min(6, Math.ceil(campaigns.length / 3)) : 0;
  const popular = campaigns?.slice(0, popularCount) ?? [], more = campaigns?.slice(popularCount) ?? [];
  return <main className="dash-content campaigns-content">
    {discover && <FeaturedBanner items={discover.hero} />}
    <h1 className="campaigns-heading">Describe the campaign you want to clip</h1>
    <EditComposer className="campaigns-search" variant="compact" appearance="flat" value={text} onChange={setText} onSubmit={() => run(text.trim())} placeholder="Gaming, podcasts, $2 per 1K views" attachControl={<></>} />
    <div className="campaigns-credit">
      <p className="campaigns-source">Campaigns from Content Rewards{typeof updatedAt === 'number' && <> · updated {timeAgo(updatedAt, now)}</>}</p>
      <Button asChild variant="ghost" size="sm" className="campaigns-see-all"><Link href={ALL_PATH}>All campaigns</Link></Button>
    </div>
    {!searching && featured !== false ? (!discover ? <p className="campaigns-loading" role="status">Loading campaigns…</p> : <>
        {discover.trending.length > 0 && <CardRow title="Trending this week" seeAll={false} campaigns={discover.trending} now={now} />}
        {discover.fresh.length > 0 && <CardRow title="New campaigns" seeAll={false} campaigns={discover.fresh} now={now} />}
        {discover.searched.length > 0 && <CardRow title="Most searched" seeAll={false} campaigns={discover.searched} now={now} />}
        {discover.clips.length > 0 && <CardRow title="Top clips" now={now} seeAll={false}>{discover.clips.map(clip => <ClipCard key={clip.postUrl} clip={clip} />)}</CardRow>}
      </>)
      : error ? <div className="dash-empty" role="alert"><h2>Could not load campaigns</h2><p>Check your connection and try again.</p><Button variant="soft" onClick={() => void run(wanted)}>Try again</Button></div>
      : !campaigns ? <p className="campaigns-loading" role="status">Loading campaigns…</p>
      : !campaigns.length ? <div className="dash-empty"><h2>{searching ? 'No campaigns match' : 'No campaigns yet'}</h2><p>{searching ? 'Try other words.' : 'Campaigns you can clip for will show here.'}</p></div>
      : searching ? <Section title="Results"><div className="campaigns-grid">{campaigns.map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div></Section>
      : <>
        <CardRow title="Popular now" campaigns={popular} now={now} />
        {more.length > 0 && <Section title="More campaigns" seeAll>
          <div className="campaigns-grid">{more.slice(0, MORE_PREVIEW).map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div>
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
      {!mine ? <p className="campaigns-loading" role="status">Loading your campaigns…</p>
        : !mine.length ? <div className="dash-empty"><h2>Nothing saved yet</h2><p>Save a campaign, or make clips for one, and it shows here.</p></div>
        : <div className="campaigns-grid">{mine.map(entry => <CampaignCard key={entry.campaign._id} campaign={entry.campaign} now={now} />)}</div>}
    </section>
  </main>;
}

/** /campaigns/all: every open campaign in one grid, hottest first. */
export function AllCampaignsPage() {
  const { isAuthenticated } = useConvexAuth();
  const search = useAction(api.campaignsSearch.search);
  const now = useNow();
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isAuthenticated) return;
    let current = true;
    search({ limit: ALL_LIMIT }).then(result => { if (current) { setError(false); setCampaigns(result.campaigns.map(entry => entry.campaign)); } }, () => { if (current) setError(true); });
    return () => { current = false; };
  }, [isAuthenticated, search, attempt]);
  return <div className="dash-page">
    <DashboardNavbar back={{ href: '/campaigns' }} />
    <main className="dash-content campaigns-content">
      <section className="campaigns-section campaigns-mine">
        <div className="campaigns-section-head"><h1>All campaigns</h1></div>
        {error ? <div className="dash-empty" role="alert"><h2>Could not load campaigns</h2><p>Check your connection and try again.</p><Button variant="soft" onClick={() => setAttempt(count => count + 1)}>Try again</Button></div>
          : !campaigns ? <p className="campaigns-loading" role="status">Loading campaigns…</p>
          : !campaigns.length ? <div className="dash-empty"><h2>No campaigns yet</h2><p>Campaigns you can clip for will show here.</p></div>
          : <div className="campaigns-grid">{campaigns.map(campaign => <CampaignCard key={campaign._id} campaign={campaign} now={now} />)}</div>}
      </section>
    </main>
  </div>;
}

export function CampaignsPage({ view }: { view: CampaignsView }) {
  const router = useRouter();
  const now = useNow();
  return <div className="dash-page">
    <DashboardNavbar title="Campaigns"><Segmented aria-label="Which campaigns to show" value={view} options={VIEWS} onValueChange={next => router.replace(next === 'mine' ? '/campaigns?view=mine' : '/campaigns')} /></DashboardNavbar>
    {view === 'mine' ? <MyCampaigns now={now} /> : <AllCampaigns now={now} />}
  </div>;
}
