'use client';
// Stats: estimated earnings, four totals, and the user's campaigns with their views, posts and estimate.
// Every number is read from the backend; with nothing posted yet they are honest zeros.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import { Eye, Megaphone, Plug, Send, type LucideIcon } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { CampaignImage } from '@/components/campaigns/campaign-card';
import { count, money } from '@/components/campaigns/campaign-format';
import { MakeClipsButton } from '@/components/campaigns/make-clips-button';
import '@/components/campaigns/campaigns.css';

/** By the viewer's own clock, so it is worked out in the browser, never on the server. */
function greeting(hour: number) { return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }

function Tile({ icon: Icon, value, label }: { icon: LucideIcon; value: number | undefined; label: string }) {
  return <Card variant="tile" className="stats-tile"><span className="stats-tile-icon"><Icon fill="currentColor" aria-hidden="true" /></span><div><strong>{value === undefined ? <Skeleton as="span" className="inline-block h-4 w-8 align-middle" /> : count(value)}</strong><span>{label}</span></div></Card>;
}

/** Three campaign rows, still, while the user's campaigns load. */
export function StatsRowsSkeleton() {
  return <div role="status" aria-label="Loading your campaigns">{Array.from({ length: 3 }, (_, index) => <Card key={index} variant="tile" className="stats-campaign-row">
    <Skeleton className="stats-campaign-thumb" /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-4 w-48 max-w-full" /><Skeleton className="h-3 w-64 max-w-full" /></div>
  </Card>)}</div>;
}

export function StatsPage() {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const skip = isAuthenticated ? {} : 'skip' as const;
  const stats = useQuery(api.posting.stats, skip), earnings = useQuery(api.posting.earnings, skip);
  const mine = useQuery(api.campaigns.mine, skip), accounts = useQuery(api.posting.accounts, skip);
  const [hour, setHour] = useState<number | null>(null);
  const [clipsError, setClipsError] = useState('');
  useEffect(() => setHour(new Date().getHours()), []);
  const perCampaign = new Map(earnings?.campaigns.map(entry => [entry.campaignId as string, entry]));
  // Saved and attached campaigns first, then any other campaign the user's posts earned from, so the rows add up to the total.
  const listed = new Set(mine?.map(entry => entry.campaign._id as string));
  const rows = mine && earnings ? [
    ...mine.map(({ campaign }) => ({ id: campaign._id as string, name: campaign.name, imageUrl: campaign.imageUrl, ended: campaign.ended })),
    ...earnings.campaigns.filter(entry => !listed.has(entry.campaignId)).map(entry => ({ id: entry.campaignId as string, name: entry.name, imageUrl: entry.imageUrl, ended: entry.ended })),
  ] : undefined;
  return <div className="dash-page">
    <DashboardNavbar title="Stats" />
    <main className="dash-content stats-content">
      <div className="stats-greeting"><h1>{hour === null ? 'Hello' : greeting(hour)}{user?.firstName ? `, ${user.firstName}` : ''}</h1><p>Here is how your clips are doing.</p></div>
      <Card variant="dash" className="stats-earnings">
        <h2>Estimated earnings</h2>
        <p className="stats-earnings-amount">{earnings ? money(earnings.estimatedCents, { whole: true }) : <Skeleton as="span" className="inline-block h-8 w-28 align-middle" />}</p>
        <p className="stats-earnings-note">Estimate: your views × the campaign&apos;s rate. Content Rewards sets the real payout.</p>
        <div className="stats-tiles">
          <Tile icon={Eye} value={stats?.overall.views} label="Views" />
          <Tile icon={Send} value={stats?.overall.posts} label="Posts" />
          <Tile icon={Megaphone} value={rows?.length} label="Campaigns" />
          <Tile icon={Plug} value={accounts?.length} label="Accounts" />
        </div>
      </Card>
      <Card variant="dash" className="stats-campaigns">
        <div className="stats-campaigns-head"><h2>Your campaigns</h2>{!!rows?.length && <Button asChild variant="ghost" size="sm" className="campaigns-see-all"><Link href="/campaigns?view=mine">See all</Link></Button>}</div>
        {clipsError && <p className="campaign-error" role="alert">{clipsError}</p>}
        {!rows ? <StatsRowsSkeleton />
          : !rows.length ? <div className="dash-empty stats-empty"><h2>Nothing saved yet</h2><p>Save a campaign, or make clips for one, and its views and estimate show here.</p><Button asChild variant="soft"><Link href="/campaigns">Find a campaign</Link></Button></div>
          : rows.map(row => {
            const totals = perCampaign.get(row.id);
            return <Card key={row.id} variant="tile" className="stats-campaign-row">
              <Link href={`/campaigns/${row.id}`} className="stats-campaign-link"><CampaignImage url={row.imageUrl} className="stats-campaign-thumb" />
                <span className="stats-campaign-text"><strong>{row.name}</strong><span><span>Views <b>{count(totals?.views ?? 0)}</b></span><i aria-hidden="true">·</i><span>Posts <b>{count(totals?.posts ?? 0)}</b></span><i aria-hidden="true">·</i><span>Est. <b>{money(totals?.estimatedCents ?? 0, { whole: true })}</b></span></span></span>
              </Link>
              {!row.ended && <MakeClipsButton campaignId={row.id as Id<'campaigns'>} name={row.name} variant="soft" onError={setClipsError} />}
            </Card>;
          })}
      </Card>
    </main>
  </div>;
}
