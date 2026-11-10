import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/* Shared landing primitives. Their styles live in the "Shared UI" block of app/landing.css. */

/** primary: the filled blue pill. soft: a borderless grey pill. quiet: a text link sized like a button. */
export type LandingButtonVariant = 'primary' | 'soft' | 'quiet';
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

/** Centered section title with an optional supporting line. */
export function LandingHeading({ id, title, description, className }: { id: string; title: ReactNode; description?: ReactNode; className?: string }) {
  return <header className={cn('landing-heading', className)}>
    <h2 id={id}>{title}</h2>
    {description && <p>{description}</p>}
  </header>;
}

/** Page section with the shared horizontal padding, labelled by its heading. */
export function LandingSection({ headingId, className, ...props }: ComponentProps<'section'> & { headingId?: string }) {
  return <section {...props} className={cn('landing-section', className)} aria-labelledby={headingId} />;
}

const SHOT_WIDTHS = { wide: [1200, 2400], half: [800, 1600] } as const;
const SHOT_SIZES = { wide: '(min-width: 1320px) 1200px, 92vw', half: '(min-width: 1100px) 760px, 92vw' } as const;

/** A product screenshot from public/landing/screens (16:10) in a rounded, hairline-bordered frame.
 *  Width and height are set so the frame holds its space before the image loads. */
export function LandingShot({ name, alt, layout = 'half', priority = false }: { name: string; alt: string; layout?: keyof typeof SHOT_WIDTHS; priority?: boolean }) {
  const [small, large] = SHOT_WIDTHS[layout];
  const file = (width: number) => `/landing/screens/${name}-${width}.webp`;
  return <div className="landing-shot">
    <img src={file(small)} srcSet={`${file(small)} ${small}w, ${file(large)} ${large}w`} sizes={SHOT_SIZES[layout]} width={small} height={small * 0.625} alt={alt} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" />
  </div>;
}
