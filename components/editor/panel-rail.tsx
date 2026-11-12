'use client';

import { Clapperboard, PanelRightClose, PanelRightOpen, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './panel-rail.css';

export type SidePanelTab = 'media' | 'effects';
const TABS = [{ id: 'media', label: 'Media', icon: Clapperboard }, { id: 'effects', label: 'Effects', icon: WandSparkles }] as const;

/** The column on the editor's right edge: Media and Effects open the side panel on that tab, the button at the foot
 *  opens or closes it. It stays when the panel is closed, so the panel is always one click away. */
export function PanelRail({ tab, open, effects, onSelect, onToggle }: { tab: SidePanelTab; open: boolean; effects: boolean; onSelect: (tab: SidePanelTab) => void; onToggle: () => void }) {
  return <nav className="panel-rail" aria-label="Side panel">
    <div className="panel-rail-tabs">
      {TABS.filter(item => effects || item.id === 'media').map(({ id, label, icon: Icon }) => <Button key={id} type="button" variant="ghost" className="panel-rail-tab" aria-pressed={open && tab === id} data-active={open && tab === id || undefined} onClick={() => onSelect(id)}>
        <Icon size={20} strokeWidth={1.5} aria-hidden="true"/><span>{label}</span>
      </Button>)}
    </div>
    <Button type="button" variant="ghost" size="icon" className="panel-rail-toggle" aria-label={open ? 'Close side panel' : 'Open side panel'} aria-expanded={open} title={open ? 'Close side panel' : 'Open side panel'} onClick={onToggle}>
      {open ? <PanelRightClose size={18} strokeWidth={1.5}/> : <PanelRightOpen size={18} strokeWidth={1.5}/>}
    </Button>
  </nav>;
}
