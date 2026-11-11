import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A still placeholder shaped like the content that is loading. It does not pulse: nothing moves unless asked for. */
export function Skeleton({ as: Element = 'div', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'span' }) {
  return <Element data-slot="skeleton" aria-hidden="true" className={cn('rounded-md bg-muted', className)} {...props}/>;
}
