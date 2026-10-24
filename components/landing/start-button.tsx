'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useAuth } from '@clerk/nextjs';
import { LandingButton, type LandingButtonSize, type LandingButtonVariant } from './ui';

/** Sends visitors to sign in, and signed-in members straight to a new project. */
export function LandingStartButton({ label = 'Get started for free', variant = 'primary', size, block }: { label?: string; variant?: LandingButtonVariant; size?: LandingButtonSize; block?: boolean }) {
  const { isSignedIn } = useAuth();
  return <LandingButton href={isSignedIn ? NEW_PROJECT_PATH : '/sign-in'} variant={variant} size={size} block={block}>{label}</LandingButton>;
}
