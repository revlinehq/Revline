'use client';

import type { CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import './inspector-select.css';

type InspectorOption<Value extends string> = { value: Value; label: string; description?: string; style?: CSSProperties };

/** Inspector choices share the editor's accessible menu behavior. */
export function InspectorSelect<Value extends string>({ label, value, options, onChange, disabled = false }: {
  disabled?: boolean;
  label: string;
  value: Value;
  options: readonly InspectorOption<Value>[];
  onChange: (value: Value) => void;
}) {
  const selected = options.find(option => option.value === value) ?? options[0];
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="inspector-select-trigger" aria-label={label} disabled={disabled}><span className="inspector-select-value" style={selected?.style}>{selected?.label}</span><ChevronDown size={13}/></button></DropdownMenuTrigger>
    <DropdownMenuContent className="workspace-menu inspector-select-menu" aria-label={`${label} options`} sideOffset={5}>
      <DropdownMenuRadioGroup value={value} onValueChange={next => { const option = options.find(option => option.value === next); if (option) onChange(option.value); }}>
        {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} data-value={option.value} className="workspace-menu-item inspector-select-option"><span className="inspector-select-option-copy"><span className="inspector-select-value" style={option.style}>{option.label}</span>{option.description && <small>{option.description}</small>}</span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
