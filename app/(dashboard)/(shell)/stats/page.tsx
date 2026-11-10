import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar';

export const metadata = { title: 'Stats · Revline' };

export default function StatsRoute() {
  return <div className="dash-page">
    <DashboardNavbar title="Stats" />
    <main className="dash-content"><div className="dash-empty"><h2>No posts yet</h2><p>Views and estimated earnings show here once you post clips.</p></div></main>
  </div>;
}
