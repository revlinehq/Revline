'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { DEFAULT_EDITOR_EDIT_MODE, type EditorEditModePreference } from '@/lib/ai/edit-mode';
import { InspectorSelect } from './inspector-select';
import './assistant-model-picker.css';

const EDIT_MODES = [
  { value: 'auto', label: 'Auto', description: 'Picks the right mode for each request' },
  { value: 'fast', label: 'Fast', description: 'Edits quickly with lighter checks' },
  { value: 'precise', label: 'Precise', description: 'Watches full video like a human' },
] as const;

/** The composer preference passed with each request, independent of the model and its effort. */
export function useAssistantEditMode() {
  const { userId } = useAuth();
  const storageKey = userId ? `revline:editor-mode:${userId}` : undefined;
  const [selection, setSelection] = useState<{ storageKey: string | undefined; value: EditorEditModePreference }>({ storageKey: undefined, value: DEFAULT_EDITOR_EDIT_MODE });
  const value = selection.storageKey === storageKey ? selection.value : DEFAULT_EDITOR_EDIT_MODE;

  useEffect(() => {
    let saved: string | null = null;
    try { if (storageKey) saved = localStorage.getItem(storageKey); } catch { /* Use Fast when storage is unavailable. */ }
    setSelection({ storageKey, value: EDIT_MODES.find(mode => mode.value === saved)?.value ?? DEFAULT_EDITOR_EDIT_MODE });
  }, [storageKey]);

  function chooseMode(value: EditorEditModePreference) {
    setSelection({ storageKey, value });
    try { if (storageKey) localStorage.setItem(storageKey, value); } catch { /* Keep the choice for this visit. */ }
  }

  return { value, onChange: chooseMode };
}

export function AssistantModePicker({ value, onChange, disabled }: ReturnType<typeof useAssistantEditMode> & { disabled: boolean }) {
  return <div className="assistant-model-picker assistant-mode-picker"><InspectorSelect label="Editing mode" value={value} options={EDIT_MODES} onChange={onChange} disabled={disabled}/></div>;
}
