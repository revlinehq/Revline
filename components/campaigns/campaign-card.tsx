'use client';
// The one campaign card, used by All and Mine: image, NEW, title, best rate, platforms, budget. Nothing else.
import { useState } from 'react';
import Link from 'next/link';
import type { CampaignView } from '@/convex/campaignsModel';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { budgetSpentPercent, isNewCampaign, money } from './campaign-format';
import { PlatformIcon, orderedPlatforms } from './platform-icon';

/** The campaign's image, or a plain tile when it has none or it fails to load. */
export function CampaignImage({ url, className }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element -- remote campaign art of unknown size, shown as stored
  return url && !failed ? <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <div className={className} data-empty="" />;
}

export function CampaignCard({ campaign, now }: { campaign: CampaignView; now: number }) {
  const spent = budgetSpentPercent(campaign);
  return <Card variant="dash" className="campaign-card">
    <Link href={`/campaigns/${campaign._id}`} className="campaign-card-link" aria-label={campaign.name}>
      <div className="campaign-card-art"><CampaignImage url={campaign.imageUrl} className="campaign-card-image" />{isNewCampaign(campaign, now) && <Badge variant="new" className="campaign-card-new">NEW</Badge>}</div>
      <div className="campaign-card-body">
        <strong className="campaign-card-title">{campaign.name}</strong>
        <div className="campaign-card-rate">
          {campaign.maxRateCents > 0 && <span><b>{money(campaign.maxRateCents)}</b> per 1K views</span>}
          <span className="campaign-card-platforms">{orderedPlatforms(campaign.platforms).map(platform => <PlatformIcon key={platform} platform={platform} />)}</span>
        </div>
        {spent !== null && campaign.budgetLeftCents !== undefined ? <>
          <Progress className="campaign-budget-bar" value={spent} aria-label="Budget spent" />
          <span className="campaign-card-left">{money(campaign.budgetLeftCents, { whole: true })} left</span>
        </> : <span className="campaign-card-left campaign-card-open">Open budget</span>}
      </div>
    </Link>
  </Card>;
}
