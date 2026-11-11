import { CampaignDetail } from '@/components/campaigns/campaign-detail';

export const metadata = { title: 'Campaign · Revline' };

export default async function CampaignRoute({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  return <CampaignDetail key={campaignId} campaignId={campaignId} />;
}
