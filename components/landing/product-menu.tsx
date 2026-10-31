'use client';

import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// The page's product sections, in page order.
const sections = [
  { label: 'Edited with Revline', note: 'Videos made in Revline', href: '#use-cases' },
  { label: 'How it works', note: 'From raw clips to a finished cut', href: '#how-it-works' },
  { label: 'Features', note: 'Effects done by asking', href: '#features' },
  { label: 'Motion', note: 'Launch videos, explainers, motion elements', href: '#motion' },
  { label: 'Inspo Motion', note: 'Recreate a launch video from a link', href: '#inspo', fresh: true },
  { label: 'MCP', note: 'Edit from any AI agent', href: '#mcp' },
];

export function LandingProductMenu() {
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger className="landing-nav-menu">Product<ChevronDown size={14} aria-hidden="true" /></DropdownMenuTrigger>
    <DropdownMenuContent align="center" sideOffset={10} className="landing-product-menu w-72 p-1.5">
      {sections.map(section => <DropdownMenuItem key={section.href} asChild className="flex-col items-start gap-0.5 px-3 py-2">
        <a href={section.href}>
          <span className="landing-product-menu-label">{section.label}{section.fresh && <span className="landing-product-menu-new">New</span>}</span>
          <span className="landing-product-menu-note">{section.note}</span>
        </a>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
