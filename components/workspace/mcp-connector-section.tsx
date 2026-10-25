'use client';
import { userError } from '@/lib/user-error';

import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from './primary-button';
import { ClaudeLogo, OpenAILogo } from './ai-app-logos';
import './mcp-connector-section.css';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return <div className="mcp-copy-field"><code aria-label={label}>{value}</code><button type="button" className="workspace-outline-button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button></div>;
}

const when = (time?: number) => time ? new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

// Claude and ChatGPT only add custom MCP servers from their own settings, so each needs the link pasted once;
// sign-in then runs through Revline's OAuth consent page automatically.
const APPS = {
  claude: { name: 'Claude', Logo: ClaudeLogo, match: /claude/i, settingsUrl: 'https://claude.ai/settings/connectors', settingsLabel: 'Open Claude connectors',
    steps: 'Choose Add custom connector, paste the link, then sign in to Revline when asked.' },
  chatgpt: { name: 'ChatGPT', Logo: OpenAILogo, match: /chatgpt|openai/i, settingsUrl: 'https://chatgpt.com/#settings/Connectors', settingsLabel: 'Open ChatGPT settings',
    steps: 'Turn on Developer mode under Advanced, choose Create, paste the link and pick OAuth. Then sign in to Revline when asked. Needs a ChatGPT plan with Developer mode.' },
} as const;
type AppId = keyof typeof APPS;

/** Ultra: connect Claude or ChatGPT to edit projects with the editor's own tools. */
export function McpConnectorSection() {
  const { isAuthenticated } = useConvexAuth();
  const connector = useQuery(api.mcpAuth.connector, isAuthenticated ? {} : 'skip');
  const createToken = useMutation(api.mcpAuth.createPersonalToken);
  const revoke = useMutation(api.mcpAuth.revokeConnection);
  const [open, setOpen] = useState<AppId | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!connector?.allowed) return null;

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key); setError('');
    try { await work(); } catch (cause) { setError(userError(cause, 'Could not update the connection. Please try again.')); }
    finally { setBusy(''); }
  }
  const connected = (app: AppId) => connector.connections.some(connection => connection.kind !== 'personal' && APPS[app].match.test(connection.label));
  const app = open ? APPS[open] : null;

  return <section className="workspace-profile-section mcp-connector"><div className="workspace-section-label"><h2>Connect AI apps</h2></div>
    <div className="workspace-section-content">
      <div className="mcp-apps">
        {(Object.keys(APPS) as AppId[]).map(id => {
          const { name, Logo } = APPS[id];
          return <button key={id} type="button" className="mcp-app-button" onClick={() => setOpen(id)}><Logo width={18} height={18} /><span>Connect {name}</span>{connected(id) && <small><Check size={12} />Connected</small>}</button>;
        })}
      </div>
      {connector.connections.length > 0 && <ul className="mcp-connections">
        {connector.connections.map(connection => <li key={connection.grantId}><div><span>{connection.label}</span><small>{connection.kind === 'personal' ? 'Personal token' : 'App'} · added {when(connection.createdAt)} · last used {when(connection.lastUsedAt)}</small></div>
          <button type="button" className="workspace-outline-button" disabled={!!busy} onClick={() => void run(connection.grantId, async () => { await revoke({ grantId: connection.grantId }); })}>{busy === connection.grantId && <LoaderCircle size={12} className="animate-spin" />}Revoke</button></li>)}
      </ul>}
      <details className="mcp-advanced"><summary>Other apps and scripts</summary>
        <p>Any MCP client can use this link and sign in to Revline. Scripts can use a personal token as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
        <CopyField label="MCP server URL" value={connector.mcpUrl} />
        {token ? <><CopyField label="New personal token" value={token} /><p>Copy it now; it won&apos;t be shown again.</p></>
          : <PrimaryButton size="compact" disabled={!!busy} onClick={() => void run('create', async () => setToken((await createToken({ label: 'Personal token' })).token))}>{busy === 'create' && <LoaderCircle size={13} className="animate-spin" />}Create personal token</PrimaryButton>}
      </details>
      {error && <p className="workspace-inline-error" role="alert">{error}</p>}
    </div>
    <Dialog open={!!app} onOpenChange={next => { if (!next) setOpen(null); }}>
      {app && <DialogContent className="workspace-dialog mcp-dialog">
        <div className="mcp-dialog-title"><app.Logo width={22} height={22} /><DialogTitle>Connect {app.name}</DialogTitle></div>
        <DialogDescription>Two steps, once. After that {app.name} can open and edit your Revline projects.</DialogDescription>
        <ol className="mcp-dialog-steps">
          <li><strong>Copy your Revline link</strong><CopyField label="Revline MCP link" value={connector.mcpUrl} /></li>
          <li><strong>Add it in {app.name}</strong><p>{app.steps}</p>
            <a className="workspace-outline-button mcp-open-link" href={app.settingsUrl} target="_blank" rel="noreferrer">{app.settingsLabel}<ExternalLink size={13} /></a></li>
        </ol>
        {open === 'claude' && <details className="mcp-advanced"><summary>Using Claude Code?</summary><CopyField label="Claude Code command" value={`claude mcp add --transport http revline ${connector.mcpUrl}`} /><p>Then run <code>/mcp</code> in Claude Code to sign in.</p></details>}
      </DialogContent>}
    </Dialog>
  </section>;
}
