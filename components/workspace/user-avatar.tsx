'use client';
import { useState, type ComponentProps } from 'react';
import { useUser } from '@clerk/nextjs';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** The saved picture of the signed-in person's earliest connected account that has one; null when there is none, undefined while loading. */
export function useConnectedPicture() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.posting.profilePicture, isAuthenticated ? {} : 'skip');
}

/**
 * The signed-in person's picture: the saved picture of their earliest connected social account that has one,
 * otherwise their sign-in photo, otherwise `fallback` (their initials).
 */
export function UserAvatar({ fallback, alt = '', ...props }: { fallback: string; alt?: string } & ComponentProps<typeof Avatar>) {
  const { user } = useUser(), { isLoading, isAuthenticated } = useConvexAuth(), picture = useConnectedPicture();
  // A saved picture that will not load gives way to the sign-in photo.
  const [broken, setBroken] = useState<string | null>(null);
  const connected = picture && picture !== broken ? picture : null;
  // Nothing is drawn until it is known which picture applies, so the sign-in photo never shows first and then swaps.
  const src = isLoading || (isAuthenticated && picture === undefined) ? undefined : connected ?? user?.imageUrl;
  return <Avatar {...props}>
    {src && <AvatarImage key={src} src={src} alt={alt} onLoadingStatusChange={status => { if (status === 'error' && connected) setBroken(connected); }} />}
    <AvatarFallback>{fallback}</AvatarFallback>
  </Avatar>;
}
