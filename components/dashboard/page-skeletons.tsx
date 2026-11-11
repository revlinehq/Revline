// What a shell page shows the moment its link is clicked, if the page itself has not been loaded ahead of the click
// (each route's loading.tsx): the page's frame under the shell's navbar, with still placeholders where its data will be.
// The pages show the same placeholders themselves while their data loads, so nothing shifts when they take over.
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountsSkeleton } from '@/components/posting/accounts-page';
import { PostsSkeleton } from '@/components/posting/posts-page';
import { StatsRowsSkeleton } from '@/components/stats/stats-page';
import { ChatRowsSkeleton } from '@/components/workspace/chat-history';
import { SettingsSkeleton } from '@/components/workspace/profile-page';
import '@/components/stats/stats.css';
import '@/components/posting/posting.css';
import './dash-list.css';

export function StatsPageSkeleton() {
  return <main className="dash-content stats-content">
    <div className="stats-greeting"><h1>Hello</h1><p>Here is how your posts are doing.</p></div>
    <Card variant="dash" className="stats-card">
      <h2>All posts</h2>
      <div className="stats-tiles">{['Views', 'Posts', 'Likes', 'Comments', 'Shares', 'Accounts'].map(label => <Card key={label} variant="tile" className="stats-tile"><Skeleton as="span" className="stats-tile-icon" /><div><strong><Skeleton as="span" className="inline-block h-4 w-8 align-middle" /></strong><span>{label}</span></div></Card>)}</div>
    </Card>
    <Card variant="dash" className="stats-card"><h2>By account</h2><StatsRowsSkeleton /></Card>
  </main>;
}

export function PostsPageSkeleton() {
  return <main className="dash-content posts-page"><PostsSkeleton /></main>;
}

export function AccountsPageSkeleton() {
  return <main className="dash-content"><div className="dash-column">
    <p className="dash-column-note">Revline posts your clips to the accounts you connect here.</p>
    <AccountsSkeleton />
  </div></main>;
}

export function SettingsPageSkeleton() {
  return <main className="dash-content"><div className="dash-column settings-page"><SettingsSkeleton /></div></main>;
}

/** The AI Editor's start page: its heading and composer, as placeholders. */
export function NewProjectPageSkeleton() {
  return <main className="dash-content flex flex-col items-center" aria-busy="true">
    <Skeleton className="mt-[84px] h-10 w-[420px] max-w-full" /><Skeleton className="mt-6 h-[108px] w-full max-w-[656px] rounded-xl" />
  </main>;
}

export function ChatsPageSkeleton() {
  return <div className="workspace-page workspace-history-page"><main className="workspace-history-content">
    <div className="workspace-page-heading"><h1>Your chats</h1><p>Continue where you left off, or start something new.</p></div>
    <div className="workspace-history-tools"><Skeleton className="h-8 flex-1" /><Skeleton className="h-8 w-36" /></div>
    <ChatRowsSkeleton />
  </main></div>;
}
