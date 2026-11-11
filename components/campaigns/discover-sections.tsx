'use client';
// What Content Rewards features on its Discover page, as shown on Campaigns: the banner of featured campaigns
// and a top clip's card. The rows of campaign cards are built in campaigns-page.tsx from the one CampaignCard.
import { useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CampaignImage } from './campaign-card';
import { compactCount, money } from './campaign-format';
import { PlatformIcon, platformName } from './platform-icon';

export type DiscoverSections = FunctionReturnType<typeof api.campaignsDiscover.sections>;

/** One large card per featured campaign. The person moves between them; it never advances by itself. */
export function FeaturedBanner({ items }: { items: DiscoverSections['hero'] }) {
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const at = Math.min(index, items.length - 1);
  const { campaign, category } = items[at];
  const organization = campaign.organization;
  const facts = [
    category ?? campaign.contentCategories[0]?.name,
    campaign.maxRateCents > 0 ? `${money(campaign.maxRateCents)} per 1K views` : undefined,
    campaign.budgetCents ? `${money(campaign.budgetCents, { whole: true })} budget` : undefined,
  ].filter(Boolean);
  const step = (by: number) => setIndex((at + by + items.length) % items.length);
  return <Card variant="dash" className="campaigns-banner" role="group" aria-roledescription="carousel" aria-label="Featured campaigns">
    <CampaignImage key={campaign._id} url={campaign.imageUrl} className="campaigns-banner-image" />
    {items.length > 1 && <div className="campaigns-banner-nav">
      <Button variant="ghost" size="icon-xs" aria-label="Previous featured campaign" onClick={() => step(-1)}><ChevronLeft /></Button>
      {items.map((item, position) => <Button key={item.campaign._id} variant="ghost" size="icon-xs" className="campaigns-banner-dot" aria-label={`${item.campaign.name}, ${position + 1} of ${items.length}`} aria-current={position === at ? 'true' : undefined} onClick={() => setIndex(position)} />)}
      <Button variant="ghost" size="icon-xs" aria-label="Next featured campaign" onClick={() => step(1)}><ChevronRight /></Button>
    </div>}
    <div className="campaigns-banner-foot">
      <div className="campaigns-banner-text">
        {organization && <p className="campaigns-banner-brand">
          <Avatar size="sm" className="campaigns-banner-avatar">{organization.logoUrl && <AvatarImage src={organization.logoUrl} alt="" referrerPolicy="no-referrer" />}<AvatarFallback>{organization.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
          {organization.name}{organization.verified && <BadgeCheck size={14} aria-label="Verified" />}
        </p>}
        <h2>{campaign.name}</h2>
        {facts.length > 0 && <p className="campaigns-banner-facts">{facts.join(' · ')}</p>}
      </div>
      <Button asChild variant="primary"><Link href={`/campaigns/${campaign._id}`}>View campaign</Link></Button>
    </div>
  </Card>;
}

/** A top clip: its thumbnail, title, views and platform. Opens the original post in a new tab. */
export function ClipCard({ clip }: { clip: DiscoverSections['clips'][number] }) {
  const platform = platformName(clip.platform);
  return <Card variant="dash" className="clip-card">
    <a href={clip.postUrl} target="_blank" rel="noopener noreferrer" className="clip-card-link" aria-label={`${clip.title ?? 'Clip'} on ${platform}, opens in a new tab`}>
      <CampaignImage url={clip.thumbnailUrl} className="clip-card-image" />
      <div className="clip-card-body">
        <strong className="clip-card-title">{clip.title ?? `Clip on ${platform}`}</strong>
        <span className="clip-card-views"><b>{compactCount(clip.views)}</b> views<PlatformIcon platform={clip.platform} /></span>
        {clip.campaign && <span className="clip-card-campaign">{clip.campaign.name}</span>}
      </div>
    </a>
  </Card>;
}
