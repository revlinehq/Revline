import { CampaignDetail } from '@/components/campaigns/campaign-detail';

export const metadata = { title: 'Campaign · Revline' };

export default async function CampaignRoute({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ clips?: string }> }) {
  const [{ campaignId }, { clips }] = await Promise.all([params, searchParams]);
  return <CampaignDetail key={campaignId} campaignId={campaignId} openClips={clips === '1'} />;
}
