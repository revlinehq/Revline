'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useAuth } from '@clerk/nextjs';
import { LandingButton, type LandingButtonSize, type LandingButtonVariant } from './ui';

/** Sends visitors to sign in, and signed-in members straight to a new project (or `signedInHref`). */
export function LandingStartButton({ label = 'Get started for free', variant = 'primary', size, block, signedInHref = NEW_PROJECT_PATH }: { label?: string; variant?: LandingButtonVariant; size?: LandingButtonSize; block?: boolean; signedInHref?: string }) {
  const { isSignedIn } = useAuth();
  return <LandingButton href={isSignedIn ? signedInHref : '/sign-in'} variant={variant} size={size} block={block}>{label}</LandingButton>;
}
