'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const EDIT_MODES = [
  { value: 'fast', label: 'Fast', description: 'Edits quickly with lighter checks' },
  { value: 'precise', label: 'Precise', description: 'Checks every frame before it reports back' },
  { value: 'auto', label: 'Auto', description: 'Picks per request' },
] as const;

type AssistantEditMode = typeof EDIT_MODES[number]['value'];

/** UI preference only. Future request behavior should connect to this selection here. */
export function useAssistantEditMode() {
  const { userId } = useAuth();
  const storageKey = userId ? `revline:editor-mode:${userId}` : undefined;
  const [selection, setSelection] = useState<{ storageKey: string | undefined; value: AssistantEditMode }>({ storageKey: undefined, value: 'auto' });
  const value = selection.storageKey === storageKey ? selection.value : 'auto';

  useEffect(() => {
    let saved: string | null = null;
    try { if (storageKey) saved = localStorage.getItem(storageKey); } catch { /* Use Auto when storage is unavailable. */ }
    setSelection({ storageKey, value: EDIT_MODES.find(mode => mode.value === saved)?.value ?? 'auto' });
  }, [storageKey]);

  function chooseMode(value: AssistantEditMode) {
    setSelection({ storageKey, value });
    try { if (storageKey) localStorage.setItem(storageKey, value); } catch { /* Keep the choice for this visit. */ }
  }

  return { value, onChange: chooseMode };
}

export function AssistantModePicker({ value, onChange, disabled }: ReturnType<typeof useAssistantEditMode> & { disabled: boolean }) {
  return <div className="assistant-model-picker assistant-mode-picker"><InspectorSelect label="Editing mode" value={value} options={EDIT_MODES} onChange={onChange} disabled={disabled}/></div>;
}
