'use client';
// Stats: what the platforms report for the clips posted from Revline. Totals, then each account.
// Every number is read from the backend; with nothing posted yet they are honest zeros.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import { Eye, Heart, MessageCircle, Plug, Send, Share2, type LucideIcon } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountAvatar } from '@/components/posting/account-avatar';
import './stats.css';

const count = (value: number) => value.toLocaleString('en-US');
/** By the viewer's own clock, so it is worked out in the browser, never on the server. */
function greeting(hour: number) { return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }

function Tile({ icon: Icon, value, label }: { icon: LucideIcon; value: number | undefined; label: string }) {
  return <Card variant="tile" className="stats-tile"><span className="stats-tile-icon"><Icon fill="currentColor" aria-hidden="true" /></span><div><strong>{value === undefined ? <Skeleton as="span" className="inline-block h-4 w-8 align-middle" /> : count(value)}</strong><span>{label}</span></div></Card>;
}

/** Three account rows, still, while the numbers load. */
export function StatsRowsSkeleton() {
  return <div role="status" aria-label="Loading your accounts">{Array.from({ length: 3 }, (_, index) => <Card key={index} variant="tile" className="stats-account">
    <Skeleton className="size-8 rounded-full" /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-4 w-48 max-w-full" /><Skeleton className="h-3 w-64 max-w-full" /></div>
  </Card>)}</div>;
}

export function StatsPage() {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const skip = isAuthenticated ? {} : 'skip' as const;
  const stats = useQuery(api.posting.stats, skip), accounts = useQuery(api.posting.accounts, skip);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  const overall = stats?.overall;
  // The picture comes from the connected account; the numbers from its published posts.
  const avatars = new Map(accounts?.map(account => [account.id as string, account.avatarUrl]));
  return <main className="dash-content stats-content">
      <div className="stats-greeting"><h1>{hour === null ? 'Hello' : greeting(hour)}{user?.firstName ? `, ${user.firstName}` : ''}</h1><p>Here is how your posts are doing.</p></div>
      <Card variant="dash" className="stats-card">
        <h2>All posts</h2>
        <div className="stats-tiles">
          <Tile icon={Eye} value={overall?.views} label="Views" />
          <Tile icon={Send} value={overall?.posts} label="Posts" />
          <Tile icon={Heart} value={overall?.likes} label="Likes" />
          <Tile icon={MessageCircle} value={overall?.comments} label="Comments" />
          <Tile icon={Share2} value={overall?.shares} label="Shares" />
          <Tile icon={Plug} value={accounts?.length} label="Accounts" />
        </div>
      </Card>
      <Card variant="dash" className="stats-card">
        <h2>By account</h2>
        {!stats ? <StatsRowsSkeleton />
          : !stats.accounts.length ? <div className="dash-empty stats-empty"><h2>Nothing posted yet</h2><p>Post a clip from the editor and its views, likes and comments show here.</p><Button asChild variant="soft"><Link href="/posts">Go to Posts</Link></Button></div>
          : stats.accounts.map(account => <Card key={account.accountId} variant="tile" className="stats-account">
            <AccountAvatar username={account.username} avatarUrl={avatars.get(account.accountId)} platform={account.platform} />
            <span className="stats-account-text"><strong>@{account.username} · {PLATFORM_NAMES[account.platform]}</strong>
              <span><span>Views <b>{count(account.views)}</b></span><i aria-hidden="true">·</i><span>Posts <b>{count(account.posts)}</b></span><i aria-hidden="true">·</i><span>Likes <b>{count(account.likes)}</b></span><i aria-hidden="true">·</i><span>Comments <b>{count(account.comments)}</b></span></span>
            </span>
          </Card>)}
      </Card>
  </main>;
}
