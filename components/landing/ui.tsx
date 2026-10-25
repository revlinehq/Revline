import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/* Shared landing primitives. Their styles live in the "Shared UI" block of app/landing.css. */

export type LandingButtonVariant = 'primary' | 'secondary' | 'neutral' | 'dark' | 'brand' | 'inverse-outline';
export type LandingButtonSize = 'sm' | 'md' | 'lg';
type ButtonStyle = { variant?: LandingButtonVariant; size?: LandingButtonSize; block?: boolean; className?: string };
type LinkButtonProps = ButtonStyle & Omit<ComponentProps<typeof Link>, 'className'>;
type NativeButtonProps = ButtonStyle & Omit<ComponentProps<'button'>, 'className'> & { href?: undefined };

/** One button for every landing call to action: a Next link when given `href`, otherwise a native button. */
export function LandingButton({ variant = 'primary', size = 'md', block = false, className, ...props }: LinkButtonProps | NativeButtonProps) {
  const style = { className: cn('landing-button', className), 'data-variant': variant, 'data-size': size, 'data-block': block || undefined };
  if (props.href !== undefined) return <Link {...style} {...(props as Omit<LinkButtonProps, keyof ButtonStyle>)} />;
  const { type = 'button', ...button } = props as Omit<NativeButtonProps, keyof ButtonStyle>;
  return <button {...style} type={type} {...button} />;
}

/** Section title with an optional supporting line. */
export function LandingHeading({ id, title, description, align = 'start', tone = 'default', size = 'md', className }: { id: string; title: ReactNode; description?: ReactNode; align?: 'start' | 'center'; tone?: 'default' | 'inverse'; size?: 'md' | 'lg'; className?: string }) {
  return <header className={cn('landing-heading', className)} data-align={align} data-tone={tone} data-size={size}>
    <h2 id={id}>{title}</h2>
    {description && <p>{description}</p>}
  </header>;
}

/** Page section with the shared horizontal padding, labelled by its heading. */
export function LandingSection({ headingId, className, ...props }: ComponentProps<'section'> & { headingId?: string }) {
  return <section {...props} className={cn('landing-section', className)} aria-labelledby={headingId} />;
}

/** Small rounded label, used on use-case tiles and timeline edit notes. */
export function LandingChip({ tone = 'light', className, ...props }: ComponentProps<'span'> & { tone?: 'light' | 'cut' | 'caption' | 'zoom' }) {
  return <span {...props} className={cn('landing-chip', className)} data-tone={tone} />;
}

/** Intro reveal: an outline draws around the content, a shimmer sweeps it, and the content sharpens in. `order` staggers siblings. */
export function LandingReveal({ as: Tag = 'div', order = 0, className, children, ...props }: { as?: 'h1' | 'p' | 'div'; order?: number; className?: string; children: ReactNode; id?: string }) {
  return <Tag {...props} className={cn('landing-reveal', className)} style={{ '--reveal-order': order } as CSSProperties}><span className="landing-reveal-content">{children}</span></Tag>;
}
