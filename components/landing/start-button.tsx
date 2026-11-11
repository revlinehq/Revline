'use client';
import { SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';

import { useAuth } from '@clerk/nextjs';
import { LandingButton, type LandingButtonSize, type LandingButtonVariant } from './ui';

/** Sends visitors to sign in, and signed-in members to Campaigns (or `signedInHref`). */
export function LandingStartButton({ label = 'Start free trial', variant = 'primary', size, block, signedInHref = SIGNED_IN_HOME_PATH }: { label?: string; variant?: LandingButtonVariant; size?: LandingButtonSize; block?: boolean; signedInHref?: string }) {
  const { isSignedIn } = useAuth();
  return <LandingButton href={isSignedIn ? signedInHref : '/sign-in'} variant={variant} size={size} block={block}>{label}</LandingButton>;
}
