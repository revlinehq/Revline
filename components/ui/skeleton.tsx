import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ as: Element = 'div', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'span' }) {
  return <Element data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props}/>;
}
