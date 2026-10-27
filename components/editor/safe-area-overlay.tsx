'use client';

import { Bookmark, Camera, Heart, Home, MessageCircle, MoreHorizontal, Music2, Plus, PlusSquare, Repeat2, Search, Send, User, Users, Inbox, Clapperboard } from 'lucide-react';
import type { SafeAreaPlatform } from '@/lib/editor/safe-areas';
import './safe-area-overlay.css';

/** The platform's own interface drawn over the whole 9:16 frame, where it sits in the app, so text and
 * faces can be checked against what actually covers them. Preview only; never exported. */
export function SafeAreaOverlay({ platform }: { platform: SafeAreaPlatform }) {
  return <div className="safe-area-overlay" data-platform={platform} aria-hidden="true">
    {platform === 'instagram' ? <InstagramReels /> : <TikTok />}
  </div>;
}

function Action({ icon, count }: { icon: React.ReactNode; count?: string }) {
  return <span className="safe-area-action">{icon}{count && <span>{count}</span>}</span>;
}

function InstagramReels() {
  return <>
    <div className="safe-area-shade safe-area-shade-top" />
    <div className="safe-area-shade safe-area-shade-bottom" />
    <div className="safe-area-topbar"><strong>Reels</strong><Camera /></div>
    <div className="safe-area-actions">
      <Action icon={<Heart />} count="12.4K" />
      <Action icon={<MessageCircle />} count="248" />
      <Action icon={<Repeat2 />} count="56" />
      <Action icon={<Send />} count="1,024" />
      <Action icon={<MoreHorizontal />} />
      <span className="safe-area-audio-tile" />
    </div>
    <div className="safe-area-meta">
      <div className="safe-area-user"><span className="safe-area-avatar" /><strong>username</strong><span className="safe-area-follow">Follow</span></div>
      <p>Your caption sits here and can run onto a second line…</p>
      <div className="safe-area-music"><Music2 /><span>username · Original audio</span></div>
    </div>
    <nav className="safe-area-nav"><Home /><Search /><PlusSquare /><Clapperboard /><User /></nav>
  </>;
}

function TikTok() {
  return <>
    <div className="safe-area-shade safe-area-shade-top" />
    <div className="safe-area-shade safe-area-shade-bottom" />
    <div className="safe-area-topbar safe-area-tiktok-tabs"><span className="safe-area-live">LIVE</span><span>Following</span><strong>For You</strong><Search /></div>
    <div className="safe-area-actions safe-area-tiktok-actions">
      <span className="safe-area-action"><span className="safe-area-avatar safe-area-avatar-large" /><span className="safe-area-plus"><Plus /></span></span>
      <Action icon={<Heart />} count="12.4K" />
      <Action icon={<MessageCircle />} count="248" />
      <Action icon={<Bookmark />} count="1,024" />
      <Action icon={<Send />} count="356" />
      <span className="safe-area-disc" />
    </div>
    <div className="safe-area-meta">
      <div className="safe-area-user"><strong>@username</strong></div>
      <p>Your caption sits here and can run onto a second line…</p>
      <div className="safe-area-music"><Music2 /><span>original sound · username</span></div>
    </div>
    <nav className="safe-area-nav"><Home /><Users /><span className="safe-area-create"><Plus /></span><Inbox /><User /></nav>
  </>;
}
