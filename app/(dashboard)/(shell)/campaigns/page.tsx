import { Suspense } from 'react';
import { CampaignsPage } from '@/components/campaigns/campaigns-page';
import { CampaignsPageSkeleton } from '@/components/dashboard/page-skeletons';

export const metadata = { title: 'Campaigns · Revline' };

/** All or Mine is read from the address in the browser, so this page is static: the frame is there before the address is known. */
export default function CampaignsRoute() {
  return <Suspense fallback={<CampaignsPageSkeleton />}><CampaignsPage /></Suspense>;
}
