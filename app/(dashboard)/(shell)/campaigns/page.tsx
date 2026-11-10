import { CampaignsPage } from '@/components/campaigns/campaigns-page';

export const metadata = { title: 'Campaigns · Revline' };

export default async function CampaignsRoute({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <CampaignsPage view={view === 'mine' ? 'mine' : 'all'} />;
}
