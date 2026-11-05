'use client';

import { useState } from 'react';
import { ChevronDown, LockKeyhole } from 'lucide-react';
import { EDITOR_MODELS, EDITOR_REASONING_EFFORTS, type ClaudeModelChoice, type EditorReasoningEffort } from '@/lib/ai/claude-model';
import { EDITOR_MODEL_CATALOG } from '@/lib/ai/claude-model-policy';
import { ClaudeLogo, GoogleLogo, McpLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { McpConnectorDialog } from '@/components/workspace/mcp-connector-section';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import './inspector-select.css';
import './assistant-model-picker.css';

/** The provider's mark beside each model. */
const providerLogo = (id: ClaudeModelChoice) => id.startsWith('gpt') ? <OpenAILogo className="assistant-model-logo" /> : id.startsWith('gemini') ? <GoogleLogo className="assistant-model-logo" /> : <ClaudeLogo className="assistant-model-logo" />;

/** Compatibility with servers that still route Claude choices through MCP. */
const MCP_ONLY_MODELS: readonly ClaudeModelChoice[] = ['opus', 'sonnet'];
const effortLabels: Record<EditorReasoningEffort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-high' };
/** X-high shimmers in the brand gradient so the strongest effort reads as powerful. */
const EffortText = ({ value }: { value: EditorReasoningEffort }) => value === 'xhigh' ? <span className="assistant-effort-xhigh">{effortLabels[value]}</span> : <>{effortLabels[value]}</>;

type EffortSelection = {
  value: EditorReasoningEffort;
  onChange: (value: EditorReasoningEffort) => void;
};

export function AssistantModelPicker({ value, onChange, disabled, allowedModels, catalogModels = allowedModels, claudeViaMcp = false, restricted = true, modelAccessNeedsSync = false, effort }: {
  value: ClaudeModelChoice;
  onChange: (value: ClaudeModelChoice) => void;
  disabled: boolean;
  allowedModels: readonly ClaudeModelChoice[];
  catalogModels?: readonly ClaudeModelChoice[];
  claudeViaMcp?: boolean;
  restricted?: boolean;
  modelAccessNeedsSync?: boolean;
  effort?: EffortSelection;
}) {
  const [mcpOpen, setMcpOpen] = useState(false);
  const mcpOnly = (id: ClaudeModelChoice) => claudeViaMcp && MCP_ONLY_MODELS.includes(id);
  const models = EDITOR_MODELS.filter(model => EDITOR_MODEL_CATALOG.some(choice => choice === model.id));
  const locked = (id: ClaudeModelChoice) => restricted ? id !== 'gpt-6.1-terra' : !allowedModels.includes(id) && !mcpOnly(id);
  const selected = EDITOR_MODELS.find(model => model.id === value);
  const effortLabel = effort ? <EffortText value={effort.value}/> : undefined;
  return <div className="assistant-model-picker assistant-combined-model-picker">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="inspector-select-trigger" aria-label={`AI editing model${effort ? ' and reasoning effort' : ''}`} disabled={disabled}>
          {providerLogo(value)}<span className="inspector-select-value">{selected && 'shortLabel' in selected ? selected.shortLabel : selected?.label}</span>{effort && <span className="assistant-model-effort">· {effortLabel}</span>}<ChevronDown size={13}/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-menu inspector-select-menu assistant-picker-menu" aria-label="AI editing model options" sideOffset={5}>
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        {modelAccessNeedsSync && <DropdownMenuLabel className="assistant-model-restore">Restore purchases in the iPhone app to verify your paid plan.</DropdownMenuLabel>}
        <DropdownMenuRadioGroup value={value} onValueChange={next => {
          const model = models.find(model => model.id === next);
          if (model && !locked(model.id)) { if (mcpOnly(model.id)) setMcpOpen(true); else onChange(model.id); }
        }}>
          {models.map(model => <DropdownMenuRadioItem key={model.id} value={model.id} disabled={locked(model.id)} data-locked={locked(model.id)} className="workspace-menu-item inspector-select-option">
            {mcpOnly(model.id) ? <McpLogo className="assistant-model-logo"/> : providerLogo(model.id)}
            <span className="inspector-select-option-copy"><span className="inspector-select-value">{model.label}</span>{locked(model.id) && <small><LockKeyhole size={10}/> {restricted && catalogModels.includes(model.id) ? 'Paid plan' : 'Unavailable'}</small>}{!locked(model.id) && mcpOnly(model.id) && <small>Use it through MCP</small>}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {effort && <>
          <DropdownMenuSeparator/>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="workspace-menu-item assistant-effort-subtrigger">Reasoning effort<span className="assistant-effort-value">{effortLabel}</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="workspace-menu inspector-select-menu assistant-picker-menu assistant-effort-menu" aria-label="AI reasoning effort options">
              <DropdownMenuRadioGroup value={effort.value} onValueChange={next => {
                const choice = EDITOR_REASONING_EFFORTS.find(item => item === next); if (choice && (!restricted || choice === 'low')) effort.onChange(choice);
              }}>
                {EDITOR_REASONING_EFFORTS.map(choice => <DropdownMenuRadioItem key={choice} value={choice} disabled={restricted && choice !== 'low'} data-locked={restricted && choice !== 'low'} className="workspace-menu-item inspector-select-option"><EffortText value={choice}/>{restricted && choice !== 'low' && <small><LockKeyhole size={10}/> Paid plan</small>}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    <McpConnectorDialog open={mcpOpen} onOpenChange={setMcpOpen}/>
  </div>;
}
