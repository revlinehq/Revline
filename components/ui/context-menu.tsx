'use client';

import * as React from 'react';
import { ContextMenu as Primitive } from 'radix-ui';
import { cn } from 'cn';
import './context-menu.css';

export const ContextMenu=Primitive.Root;
export const ContextMenuTrigger=Primitive.Trigger;

export function ContextMenuContent({className,...props}:React.ComponentProps<typeof Primitive.Content>){
  return <Primitive.Portal><Primitive.Content data-slot="context-menu-content" className={cn('z-50 min-w-44 max-h-(--radix-context-menu-content-available-height) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10',className)} {...props}/></Primitive.Portal>;
}
export function ContextMenuItem({className,...props}:React.ComponentProps<typeof Primitive.Item>){
  return <Primitive.Item data-slot="context-menu-item" className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0',className)} {...props}/>;
}
export function ContextMenuLabel({className,...props}:React.ComponentProps<typeof Primitive.Label>){
  return <Primitive.Label className={cn('px-2 py-1.5 text-xs text-muted-foreground',className)} {...props}/>;
}
export function ContextMenuSeparator(props:React.ComponentProps<typeof Primitive.Separator>){
  return <Primitive.Separator className="my-1 h-px bg-border" {...props}/>;
}
