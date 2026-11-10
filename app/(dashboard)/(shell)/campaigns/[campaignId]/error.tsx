'use client';

import { Button } from '@/components/ui/button';
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';

/** Anything that stops the campaign from loading (a mistyped link, a failed request) lands here, with a way to retry. */
export default function CampaignError({ reset }: { error: Error; reset: () => void }) {
  return <div className="dash-page">
    <DashboardNavbar back={{ href: '/campaigns' }} />
    <main className="dash-content"><div className="dash-empty"><h2>Could not open this campaign</h2><p>The link may be wrong, or the campaign did not load. Try again, or go back to see the campaigns you can clip for.</p><Button variant="soft" onClick={reset}>Try again</Button></div></main>
  </div>;
}
