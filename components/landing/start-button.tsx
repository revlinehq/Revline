'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';

/** Sends visitors to sign in, and signed-in members straight to a new project. */
export function LandingStartButton({ label = 'Get started for free', className = '' }: { label?: string; className?: string }) {
  const { isSignedIn } = useAuth();
  return <Link className={`landing-button landing-button-primary ${className}`} href={isSignedIn ? NEW_PROJECT_PATH : '/sign-in'}>{label}</Link>;
}
