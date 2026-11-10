import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';

export const metadata = { title: 'Campaigns · Revline' };

export default function CampaignsRoute() {
  return <div className="dash-page">
    <DashboardNavbar title="Campaigns" />
    <main className="dash-content"><div className="dash-empty"><h2>No campaigns yet</h2><p>Campaigns you can clip for will show here.</p></div></main>
  </div>;
}
