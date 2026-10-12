'use client';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { PrimaryButton, FilledPlayIcon } from '@/components/workspace/primary-button';

export function LandingStartButton({ compact = false, play = true, className = '', label = 'Start editing' }: { compact?: boolean; play?: boolean; className?: string; label?: string }) {
  const { isSignedIn } = useAuth();
  return <PrimaryButton asChild size={compact ? 'compact' : 'default'} className={`landing-start-button ${compact ? '' : 'landing-start-button-large'} ${className}`}><Link href={isSignedIn ? '/dashboard/chat' : '/sign-in'}>{label}{play && <FilledPlayIcon />}</Link></PrimaryButton>;
}
