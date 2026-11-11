'use client';

import { ChevronDown } from 'lucide-react';
import { EDITOR_MODELS, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { InputGroupButton } from '@/components/ui/input-group';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

/** The provider's mark beside each model. */
const ProviderLogo = ({ id }: { id: ClaudeModelChoice }) => id.startsWith('gpt') ? <OpenAILogo className="size-3.5 shrink-0" /> : <ClaudeLogo className="size-3.5 shrink-0" />;
export const EDITOR_EFFORT_LABELS: Record<EditorReasoningEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high' };
/** The name a model runs under in the picker and under a reply; takes a picker id or the API model id. */
export const editorModelLabel = (model: string) => EDITOR_MODELS.find(item => item.id === model || item.modelId === model)?.label ?? model;

const item = 'min-h-8 gap-2 text-[13px] text-neutral-200 focus:bg-[#363636] focus:text-neutral-50 pointer-coarse:min-h-11';

/**
 * The composer's model and effort choice, one control beside attach. It lists exactly what the server offers
 * this account, so every entry is one the turn can run on; a list with one entry shows as a fact, not a choice.
 */
export function AssistantModelPicker({ model, models, onModel, effort, efforts, onEffort, disabled }: {
  model: ClaudeModelChoice; models: readonly ClaudeModelChoice[]; onModel: (value: ClaudeModelChoice) => void;
  effort: EditorReasoningEffort; efforts: readonly EditorReasoningEffort[]; onEffort: (value: EditorReasoningEffort) => void;
  disabled: boolean;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <InputGroupButton size="sm" className="assistant-model-picker min-w-0 gap-1.5 px-2 text-[13px] font-normal text-neutral-400 hover:bg-[#363636] hover:text-neutral-100 focus-visible:ring-0 focus-visible:outline-none data-[state=open]:bg-[#363636] data-[state=open]:text-neutral-100" aria-label={`AI model: ${editorModelLabel(model)}, ${EDITOR_EFFORT_LABELS[effort]} effort`} disabled={disabled}>
        <ProviderLogo id={model}/><span className="truncate">{editorModelLabel(model)}</span><span className="shrink-0 text-neutral-500">· {EDITOR_EFFORT_LABELS[effort]}</span><ChevronDown className="size-3 shrink-0"/>
      </InputGroupButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" sideOffset={6} className="min-w-44 border border-[#363636] bg-[#2a2a2a] text-neutral-200 ring-0" aria-label="AI model and effort">
      <DropdownMenuLabel className="text-[11px] font-normal text-neutral-500">Model</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={model} onValueChange={next => { const choice = models.find(id => id === next); if (choice) onModel(choice); }}>
        {models.map(id => <DropdownMenuRadioItem key={id} value={id} className={item}><ProviderLogo id={id}/>{editorModelLabel(id)}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="bg-[#3a3a3a]"/>
      <DropdownMenuLabel className="text-[11px] font-normal text-neutral-500">Effort</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={effort} onValueChange={next => { const choice = efforts.find(value => value === next); if (choice) onEffort(choice); }}>
        {efforts.map(value => <DropdownMenuRadioItem key={value} value={value} className={item}>{EDITOR_EFFORT_LABELS[value]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
