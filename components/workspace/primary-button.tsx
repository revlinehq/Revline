import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The brand-purple shadcn Button: shadcn sizes (compact is md), only the colors are Revline's. */
export function PrimaryButton({ className, size = 'default', ...props }: Omit<ComponentProps<typeof Button>, 'size'> & { size?: 'default' | 'compact' | 'icon' | 'icon-sm' }) {
  return <Button {...props} size={size === 'compact' ? 'md' : size} className={cn('revline-primary', className)} />;
}
