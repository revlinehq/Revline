'use client';
// One campaign: hero, facts, Save and Make clips, what each platform pays, the budget, and where the rules live.
// Only what the stored campaign states is shown; a missing value hides its chip or cell. An ended campaign
// reads "Ended" and no longer offers Make clips.
import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { BadgeCheck, Bookmark, BookmarkCheck, CalendarDays, ChartNoAxesColumn, ExternalLink, Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { CampaignView } from '@/convex/campaignsModel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';
import { userError } from '@/lib/user-error';
import { CampaignImage } from './campaign-card';
import { budgetSpentPercent, count, isNewCampaign, money, timeAgo } from './campaign-format';
import { useNow } from './use-now';
import { MakeClipsButton } from './make-clips-button';
import { PlatformIcon, orderedPlatforms, platformName } from './platform-icon';
import './campaigns.css';

function PayoutCard({ payout }: { payout: CampaignView['payouts'][number] }) {
  const cells = [['Per 1K views', payout.rateCents], ['Min payout', payout.minPayoutCents], ['Max payout', payout.maxPayoutCents]] as const;
  const stated = cells.filter(([, cents]) => cents !== undefined);
  return <Card variant="dash" className="campaign-fact-card">
    <h2><PlatformIcon platform={payout.platform} size={16} />{platformName(payout.platform)}</h2>
    {stated.length > 0 && <dl className="campaign-payout-cells">{stated.map(([label, cents]) => <div key={label}><dt>{label}</dt><dd>{money(cents!)}</dd></div>)}</dl>}
  </Card>;
}

function BudgetCard({ campaign }: { campaign: CampaignView }) {
  const spent = budgetSpentPercent(campaign);
  if (spent === null || campaign.budgetCents === undefined || campaign.budgetLeftCents === undefined) return null;
  return <Card variant="dash" className="campaign-fact-card">
    <h2><ChartNoAxesColumn size={16} aria-hidden="true" />Budget</h2>
    <div className="campaign-budget-body">
      <p className="campaign-budget-amount"><b>{money(campaign.budgetCents - campaign.budgetLeftCents, { whole: true })}</b> / {money(campaign.budgetCents, { whole: true })}</p>
      <Progress className="campaign-budget-bar" value={spent} aria-label="Budget spent" />
    </div>
    <p className="campaign-budget-left"><b>{money(campaign.budgetLeftCents, { whole: true })}</b> left in the budget</p>
  </Card>;
}

function Campaign({ campaign, saved }: { campaign: CampaignView; saved: boolean | undefined }) {
  const now = useNow();
  const save = useMutation(api.campaigns.save), unsave = useMutation(api.campaigns.unsave);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function toggleSaved() {
    if (saved === undefined || saving) return;
    setSaving(true); setError('');
    try { await (saved ? unsave : save)({ campaignId: campaign._id }); }
    catch (reason) { setError(userError(reason, 'Could not update your campaigns. Try again.')); }
    finally { setSaving(false); }
  }
  const launched = campaign.launchedAt ?? campaign.sourceCreatedAt;
  return <main className="dash-content campaign-detail">
    <header className="campaign-hero">
      <CampaignImage url={campaign.imageUrl} className="campaign-hero-image" />
      <div className="campaign-hero-text">
        <p>{campaign.organization && <span className="campaign-hero-brand">{campaign.organization.name}{campaign.organization.verified && <BadgeCheck size={14} aria-label="Verified" />}</span>}<span className="campaign-hero-source">on Content Rewards</span></p>
        <h1>{campaign.name}</h1>
      </div>
    </header>
    <div className="campaign-actions-row">
      <div className="campaign-chips">
        {campaign.ended ? <Badge variant="chip">Ended</Badge> : isNewCampaign(campaign, now) && <Badge variant="new">NEW</Badge>}
        {launched !== undefined && <Badge variant="chip"><CalendarDays aria-hidden="true" />Launched {timeAgo(launched, now)}</Badge>}
        {orderedPlatforms(campaign.platforms).map(platform => <Badge key={platform} variant="chip" className="campaign-chip-icon"><PlatformIcon platform={platform} size={15} /></Badge>)}
        {campaign.creatorCount !== undefined && <Badge variant="chip"><Users aria-hidden="true" />{count(campaign.creatorCount)} {campaign.creatorCount === 1 ? 'creator' : 'creators'}</Badge>}
      </div>
      <div className="campaign-actions">
        <Button variant="soft" onClick={() => void toggleSaved()} disabled={saved === undefined || saving} aria-pressed={!!saved}>{saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}{saved ? 'Saved' : 'Save'}</Button>
        {!campaign.ended && <MakeClipsButton url={campaign.url} variant="primary" />}
      </div>
    </div>
    {error && <p className="campaign-error" role="alert">{error}</p>}
    <div className="campaign-facts">
      {orderedPlatforms(campaign.payouts.map(payout => payout.platform)).map(platform => campaign.payouts.find(payout => payout.platform === platform)!).map(payout => <PayoutCard key={payout.platform} payout={payout} />)}
      <BudgetCard campaign={campaign} />
      <Card variant="dash" className="campaign-fact-card">
        <h2>Rules and footage are on Content Rewards after you join</h2>
        <div className="campaign-rules-body"><Button asChild variant="soft"><a href={campaign.url} target="_blank" rel="noreferrer">Open on Content Rewards<ExternalLink aria-hidden="true" /></a></Button></div>
      </Card>
    </div>
  </main>;
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const campaign = useQuery(api.campaigns.get, isAuthenticated ? { campaignId: campaignId as Id<'campaigns'> } : 'skip');
  const mine = useQuery(api.campaigns.mine, isAuthenticated ? {} : 'skip');
  return <div className="dash-page">
    <DashboardNavbar back={{ href: '/campaigns' }} />
    {campaign === undefined ? <main className="dash-content"><p className="campaigns-loading" role="status">Loading the campaign…</p></main>
      : campaign === null ? <main className="dash-content"><div className="dash-empty"><h2>Campaign not found</h2><p>It may have been removed. Go back to see the campaigns you can clip for.</p></div></main>
      : <Campaign campaign={campaign} saved={mine?.some(entry => entry.saved && entry.campaign._id === campaign._id)} />}
  </div>;
}
