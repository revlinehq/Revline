import type { ComponentProps, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import './dash-list.css';

/** One card of the Settings column: a name, its one action on the right, then rows or a body. */
export function SettingsCard({ id, title, action, className, children }: { id?: string; title: string; action?: ReactNode; className?: string; children?: ReactNode }) {
  return <Card variant="dash" id={id} role="region" aria-label={title} className={cn('dash-list', className)}>
    <div className="dash-list-head"><h2>{title}</h2>{action && <div className="dash-list-actions">{action}</div>}</div>
    {children}
  </Card>;
}

/** A labelled value: "Plan · Revline Pro". */
export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="dash-list-row dash-field-row"><span className="dash-field-label">{label}</span><div className="dash-field-value">{children}</div></div>;
}

/** Free content under the head: notes, forms, lists. */
export function SettingsBody({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('dash-list-body', className)} />;
}
