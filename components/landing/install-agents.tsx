'use client';
import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { McpLogo } from '@/components/workspace/ai-app-logos';
import { claudeCodeCommand, MCP_APPS, PUBLIC_MCP_URL, type McpAppId } from '@/components/workspace/mcp-apps';
import { LandingButton, type LandingButtonSize, type LandingButtonVariant } from './ui';

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return <div className="landing-install-copy"><code aria-label={label}>{value}</code><button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button></div>;
}

const tabs: McpAppId[] = ['claude', 'chatgpt', 'agent'];

/** "Install on your agents": the production MCP link and each app's one-time steps, from the same list the profile connector uses. */
export function LandingInstallAgents({ variant = 'neutral', size = 'md', initial = 'claude', label = 'Install on your agents' }: { variant?: LandingButtonVariant; size?: LandingButtonSize; initial?: McpAppId; label?: string }) {
  const [app, setApp] = useState<McpAppId>(initial);
  const current = MCP_APPS[app];
  return <Dialog onOpenChange={open => { if (open) setApp(initial); }}>
    <DialogTrigger asChild><LandingButton variant={variant} size={size}><McpLogo width={15} height={15} aria-hidden="true" />{label}</LandingButton></DialogTrigger>
    <DialogContent className="landing-install-dialog sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>Install Revline on your agents</DialogTitle>
        <DialogDescription>Add Revline once and edit your projects from Claude, ChatGPT or any MCP app. Included with Pro.</DialogDescription>
      </DialogHeader>
      <div className="landing-install-tabs" role="tablist" aria-label="Agent">
        {tabs.map(id => {
          const { Logo } = MCP_APPS[id];
          return <button key={id} type="button" role="tab" aria-selected={app === id} onClick={() => setApp(id)}><Logo width={14} height={14} aria-hidden="true" />{id === 'agent' ? 'Other agents' : MCP_APPS[id].name}</button>;
        })}
      </div>
      <ol className="landing-install-steps" role="tabpanel">
        <li><strong>Copy the Revline link</strong><CopyLine label="Revline MCP link" value={PUBLIC_MCP_URL} /></li>
        <li><strong>Add it in {current.owner}</strong><p>{current.steps}</p>
          {current.settingsUrl && <a className="landing-install-open" href={current.settingsUrl} target="_blank" rel="noreferrer">{current.settingsLabel}<ExternalLink size={13} aria-hidden="true" /></a>}</li>
        {app === 'claude' && <li><strong>Using Claude Code?</strong><CopyLine label="Claude Code command" value={claudeCodeCommand(PUBLIC_MCP_URL)} /><p>Then run <code>/mcp</code> in Claude Code to sign in.</p></li>}
      </ol>
    </DialogContent>
  </Dialog>;
}
