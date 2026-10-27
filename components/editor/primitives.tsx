import { Button } from '@/components/ui/button';
/** An icon-only button. Labelled for screen readers; no hover pop-up. */
export function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & {label: string}) {
  return <Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button>;
}
export function Field({label,children}: {label: string;children: React.ReactNode}) { return <label className="inspector-field"><span>{label}</span>{children}</label>; }
