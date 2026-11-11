'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useAuth } from '@clerk/nextjs';
import { LandingButton, type LandingButtonSize, type LandingButtonVariant } from './ui';

/** Sends visitors through sign-in to a new project, and signed-in members straight there (or to `signedInHref`). */
export function LandingStartButton({ label = 'Get started for free', variant = 'primary', size, block, signedInHref = NEW_PROJECT_PATH }: { label?: string; variant?: LandingButtonVariant; size?: LandingButtonSize; block?: boolean; signedInHref?: string }) {
  const { isSignedIn } = useAuth();
  return <LandingButton href={isSignedIn ? signedInHref : `/sign-in?redirect_url=${encodeURIComponent(signedInHref)}`} variant={variant} size={size} block={block}>{label}</LandingButton>;
}
