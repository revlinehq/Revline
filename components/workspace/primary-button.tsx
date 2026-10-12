import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function FilledPlayIcon({ className }: { className?: string }) {
  return <svg className={cn('filled-play-icon', className)} viewBox="1 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 2.8c0-0.7 0.8-1.1 1.4-0.7l7.8 4.7c0.9 0.5 0.9 1.9 0 2.4l-7.8 4.7c-0.6 0.4-1.4 0-1.4-0.7z" /></svg>;
}

export function PrimaryButton({ className, size = 'default', ...props }: Omit<ComponentProps<typeof Button>, 'size'> & { size?: 'default' | 'compact' | 'icon' }) {
  return <Button {...props} size={size === 'icon' ? 'icon' : 'default'} className={cn('revline-primary', `revline-primary-${size}`, className)} />;
}
