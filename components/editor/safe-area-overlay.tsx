'use client';

import { Fragment, memo, type CSSProperties, type ReactNode } from 'react';
import { BatteryFull, Bookmark, Camera, ChevronDown, CircleUser, Clapperboard, Ellipsis, Forward, Heart, Home, MessageCircle, MessageSquare, Music, Plus, Search, Send, Signal, Tv, User, Users, Wifi } from 'lucide-react';
import { SAFE_AREAS, type SafeAreaPlatform, type SafeAreaRect } from '@/lib/editor/safe-areas';
import './safe-area-overlay.css';

/** Positions come from the safe-area design, in pixels on a 1080×1920 frame. `--u` is one design pixel at
 * the preview's current size, so the whole interface scales with preview zoom. */
const u = (n: number) => `calc(${n} * var(--u))`;
type Box = { x: number; y: number; w?: number; h?: number };
const at = ({ x, y, w, h }: Box, extra?: CSSProperties): CSSProperties => ({ left: u(x), top: u(y), ...(w != null && { width: u(w) }), ...(h != null && { height: u(h) }), ...extra });
const text = (box: Box, size: number, weight = 400, extra?: CSSProperties) => at(box, { fontSize: u(size), fontWeight: weight, ...extra });

function Icon({ box, children }: { box: Box; children: ReactNode }) {
  return <span className="safe-area-icon" style={at(box)}>{children}</span>;
}
function Count({ x, y, children }: { x: number; y: number; children: string }) {
  return <span className="safe-area-text safe-area-count" style={text({ x, y, w: 140 }, 28, 600)}>{children}</span>;
}

/** The platform's own interface drawn over the whole 9:16 frame where it sits in the app, with the areas it
 * covers outlined, so text and faces can be checked against it. Preview only: it sits outside the rendered
 * composition, so it never reaches an export, and it ignores the pointer. */
export const SafeAreaOverlay = memo(function SafeAreaOverlay({ platform }: { platform: SafeAreaPlatform }) {
  const area = SAFE_AREAS[platform];
  return <div className="safe-area-overlay" data-platform={platform} aria-hidden="true">
    <Zone rect={area.top} label="Top bar" labelAt="below" />
    <Zone rect={area.buttons} label="Buttons" labelAt="left" />
    <Zone rect={area.bottom} label="Caption and username" labelAt="above" />
    <StatusBar />
    {platform === 'instagram' ? <InstagramReels /> : <TikTok />}
  </div>;
});

function Zone({ rect, label, labelAt }: { rect: SafeAreaRect; label: string; labelAt: 'below' | 'left' | 'above' }) {
  return <div className="safe-area-zone" style={at(rect)}><span className="safe-area-zone-label" data-at={labelAt}>{label}</span></div>;
}

function StatusBar() {
  return <>
    <span className="safe-area-text" style={text({ x: 70, y: 32 }, 34, 600)}>9:41</span>
    <Icon box={{ x: 880, y: 30, w: 40, h: 40 }}><Signal /></Icon>
    <Icon box={{ x: 932, y: 30, w: 40, h: 40 }}><Wifi /></Icon>
    <Icon box={{ x: 984, y: 28, w: 44, h: 44 }}><BatteryFull /></Icon>
  </>;
}

function InstagramReels() {
  const rail = [
    { y: 1120, icon: <Heart />, count: '48.2K' },
    { y: 1262, icon: <MessageCircle />, count: '1,204' },
    { y: 1404, icon: <Send />, count: '312' },
  ];
  return <>
    <span className="safe-area-text" style={text({ x: 44, y: 118 }, 54, 700)}>Reels</span>
    <Icon box={{ x: 196, y: 136, w: 40, h: 40 }}><ChevronDown /></Icon>
    <Icon box={{ x: 976, y: 116, w: 64, h: 64 }}><Camera /></Icon>
    {rail.map(item => <Fragment key={item.y}><Icon box={{ x: 980, y: item.y, w: 64, h: 64 }}>{item.icon}</Icon><Count x={942} y={item.y + 70}>{item.count}</Count></Fragment>)}
    <Icon box={{ x: 982, y: 1546, w: 60, h: 60 }}><Ellipsis /></Icon>
    <span className="safe-area-tile" style={at({ x: 982, y: 1640, w: 60, h: 60 }, { borderRadius: u(12), borderWidth: u(4) })} />
    <span className="safe-area-avatar" style={at({ x: 40, y: 1540, w: 64, h: 64 }, { borderWidth: u(3) })} />
    <div className="safe-area-user" style={at({ x: 120, y: 1544, h: 56 })}>
      <span className="safe-area-text" style={{ fontSize: u(36), fontWeight: 700 }}>alex.makes</span>
      <span className="safe-area-text safe-area-follow" style={{ height: u(56), fontSize: u(30), fontWeight: 600, padding: `0 ${u(22)}`, borderWidth: u(2), borderRadius: u(12) }}>Follow</span>
    </div>
    <span className="safe-area-text safe-area-line" style={text({ x: 40, y: 1626, w: 880 }, 34)}>This changed how I edit forever… <span className="safe-area-dim">more</span></span>
    <Icon box={{ x: 40, y: 1696, w: 30, h: 30 }}><Music /></Icon>
    <span className="safe-area-text" style={text({ x: 82, y: 1692 }, 30, 500)}>alex.makes · Original audio</span>
    <nav className="safe-area-tabbar" style={at({ x: 0, y: 1776, w: 1080, h: 144 })}>
      {[<Home key="home" />, <Clapperboard key="reels" />, <Send key="messages" />, <Search key="search" />, <CircleUser key="profile" />].map((icon, index) =>
        <Icon key={index} box={{ x: 108 + index * 216 - 30, y: 42, w: 60, h: 60 }}>{icon}</Icon>)}
    </nav>
  </>;
}

function TikTok() {
  const rail = [
    { y: 1092, size: 80, icon: <Heart />, countY: 1178, count: '48.2K' },
    { y: 1228, size: 76, icon: <MessageCircle />, countY: 1310, count: '1,204' },
    { y: 1364, size: 72, icon: <Bookmark />, countY: 1442, count: '8,911' },
    { y: 1494, size: 76, icon: <Forward />, countY: 1576, count: '2,031' },
  ];
  const tabs = [
    { label: 'Home', icon: <Home /> },
    { label: 'Friends', icon: <Users /> },
    null,
    { label: 'Inbox', icon: <MessageSquare /> },
    { label: 'Profile', icon: <User /> },
  ];
  return <>
    <Icon box={{ x: 44, y: 138, w: 56, h: 56 }}><Tv /></Icon>
    <span className="safe-area-text" style={text({ x: 300, y: 140 }, 38, 600, { opacity: .7 })}>Following</span>
    <span className="safe-area-text" style={text({ x: 560, y: 140 }, 38, 700)}>For You</span>
    <span className="safe-area-fill" style={at({ x: 600, y: 202, w: 64, h: 6 }, { borderRadius: u(3) })} />
    <Icon box={{ x: 976, y: 136, w: 60, h: 60 }}><Search /></Icon>
    <span className="safe-area-avatar" style={at({ x: 952, y: 950, w: 96, h: 96 }, { borderWidth: u(4) })} />
    <span className="safe-area-badge" style={at({ x: 980, y: 1026, w: 40, h: 40 })}><Plus style={{ width: u(28), height: u(28) }} /></span>
    {rail.map(item => <Fragment key={item.y}><Icon box={{ x: 1000 - item.size / 2, y: item.y, w: item.size, h: item.size }}>{item.icon}</Icon><Count x={930} y={item.countY}>{item.count}</Count></Fragment>)}
    <span className="safe-area-disc" style={at({ x: 956, y: 1676, w: 88, h: 88 }, { borderWidth: u(14) })} />
    <span className="safe-area-text" style={text({ x: 40, y: 1516 }, 38, 700)}>alex.makes</span>
    <span className="safe-area-text safe-area-caption" style={text({ x: 40, y: 1576, w: 840 }, 34)}>This changed how I edit forever #editing #creator</span>
    <Icon box={{ x: 40, y: 1706, w: 30, h: 30 }}><Music /></Icon>
    <span className="safe-area-text" style={text({ x: 82, y: 1702 }, 30, 500)}>original sound - alex.makes</span>
    <nav className="safe-area-tabbar" style={at({ x: 0, y: 1776, w: 1080, h: 144 })}>
      {tabs.map((tab, index) => tab
        ? <Fragment key={tab.label}><Icon box={{ x: 108 + index * 216 - 27, y: 26, w: 54, h: 54 }}>{tab.icon}</Icon><span className="safe-area-text safe-area-tab-label" style={text({ x: 108 + index * 216 - 70, y: 88, w: 140 }, 22, 600)}>{tab.label}</span></Fragment>
        : <span key="create" className="safe-area-create" style={at({ x: 494, y: 43, w: 92, h: 58 }, { borderRadius: u(14) })}><Plus style={{ width: u(36), height: u(36) }} /></span>)}
    </nav>
  </>;
}
