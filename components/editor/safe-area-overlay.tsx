'use client';

import { SAFE_AREAS, type SafeAreaPlatform } from '@/lib/editor/safe-areas';
import './safe-area-overlay.css';

const pct = (value: number) => `${value * 100}%`;

/** Dims what a platform's interface covers and outlines the area that stays visible. Preview only. */
export function SafeAreaOverlay({ platform }: { platform: SafeAreaPlatform }) {
  const area = SAFE_AREAS[platform], middle = 1 - area.top - area.bottom;
  return <div className="safe-area-overlay" aria-hidden="true">
    <span className="safe-area-covered" style={{ top: 0, left: 0, right: 0, height: pct(area.top) }} />
    <span className="safe-area-covered" style={{ bottom: 0, left: 0, right: 0, height: pct(area.bottom) }} />
    <span className="safe-area-covered" style={{ top: pct(area.top), left: 0, width: pct(area.left), height: pct(middle) }} />
    <span className="safe-area-covered" style={{ top: pct(area.top), right: 0, width: pct(area.right), height: pct(middle) }} />
    {area.actions.top < 1 - area.bottom && <span className="safe-area-covered safe-area-actions" style={{ top: pct(area.actions.top), right: pct(area.right), width: pct(Math.max(0, area.actions.width - area.right)), height: pct(1 - area.bottom - area.actions.top) }} />}
    <span className="safe-area-frame" style={{ top: pct(area.top), left: pct(area.left), right: pct(area.right), bottom: pct(area.bottom) }}><span className="safe-area-label">{area.label} safe area</span></span>
  </div>;
}
