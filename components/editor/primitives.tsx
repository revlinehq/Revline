import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
export function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & {label: string}) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function Field({label,children}: {label: string;children: React.ReactNode}) { return <label className="inspector-field"><span>{label}</span>{children}</label>; }
