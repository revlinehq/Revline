// What a shell page shows the moment its link is clicked, if the page itself has not been loaded ahead of the click
// (each route's loading.tsx): the navbar and the page's frame, with still placeholders where its data will be.
// The pages show the same placeholders themselves while their data loads, so nothing shifts when they take over.
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CampaignCardsSkeleton } from '@/components/campaigns/campaigns-page';
import { CampaignDetailSkeleton } from '@/components/campaigns/campaign-detail';
import { AccountsSkeleton } from '@/components/posting/accounts-page';
import { PostsSkeleton } from '@/components/posting/posts-page';
import { StatsRowsSkeleton } from '@/components/stats/stats-page';
import { ChatRowsSkeleton } from '@/components/workspace/chat-history';
import { SettingsSkeleton } from '@/components/workspace/profile-page';
import { DashboardNavbar } from './dashboard-navbar';
import '@/components/campaigns/campaigns.css';
import '@/components/posting/posting.css';
import './dash-list.css';

function Page({ title, back, children }: { title?: string; back?: { href: string }; children: ReactNode }) {
  return <div className="dash-page"><DashboardNavbar title={title} back={back} />{children}</div>;
}

export function CampaignsPageSkeleton() {
  return <Page title="Campaigns"><main className="dash-content campaigns-content">
    <h1 className="campaigns-heading">Find a campaign to clip</h1>
    <Skeleton className="mx-auto mt-7 h-12 w-full max-w-[656px] rounded-lg" />
    <CampaignCardsSkeleton label="Loading campaigns" titled />
  </main></Page>;
}

export function CampaignPageSkeleton() {
  return <Page back={{ href: '/campaigns' }}><CampaignDetailSkeleton /></Page>;
}

export function StatsPageSkeleton() {
  return <Page title="Stats"><main className="dash-content stats-content">
    <div className="stats-greeting"><h1>Hello</h1><p>Here is how your clips are doing.</p></div>
    <Card variant="dash" className="stats-earnings">
      <h2>Estimated earnings</h2>
      <p className="stats-earnings-amount"><Skeleton as="span" className="inline-block h-8 w-28 align-middle" /></p>
      <div className="stats-tiles">{['Views', 'Posts', 'Campaigns', 'Accounts'].map(label => <Card key={label} variant="tile" className="stats-tile"><Skeleton as="span" className="stats-tile-icon" /><div><strong><Skeleton as="span" className="inline-block h-4 w-8 align-middle" /></strong><span>{label}</span></div></Card>)}</div>
    </Card>
    <Card variant="dash" className="stats-campaigns"><div className="stats-campaigns-head"><h2>Your campaigns</h2></div><StatsRowsSkeleton /></Card>
  </main></Page>;
}

export function PostsPageSkeleton() {
  return <Page title="Posts"><main className="dash-content posts-page"><PostsSkeleton /></main></Page>;
}

export function AccountsPageSkeleton() {
  return <Page title="Connected accounts"><main className="dash-content"><div className="dash-column">
    <p className="dash-column-note">Revline posts your clips to the accounts you connect here.</p>
    <AccountsSkeleton />
  </div></main></Page>;
}

export function SettingsPageSkeleton() {
  return <Page title="Settings"><main className="dash-content"><div className="dash-column settings-page"><SettingsSkeleton /></div></main></Page>;
}

export function ChatsPageSkeleton() {
  return <div className="workspace-page workspace-history-page"><DashboardNavbar title="Your chats" /><main className="workspace-history-content">
    <div className="workspace-page-heading"><h1>Your chats</h1><p>Continue where you left off, or start something new.</p></div>
    <div className="workspace-history-tools"><Skeleton className="h-8 flex-1" /><Skeleton className="h-8 w-36" /></div>
    <ChatRowsSkeleton />
  </main></div>;
}

/** The AI Editor's start page: its heading and composer, as placeholders. */
export function NewProjectPageSkeleton() {
  return <Page title="AI Editor"><main className="dash-content flex flex-col items-center" aria-busy="true">
    <Skeleton className="mt-[84px] h-10 w-[420px] max-w-full" /><Skeleton className="mt-6 h-[108px] w-full max-w-[656px] rounded-xl" />
  </main></Page>;
}
