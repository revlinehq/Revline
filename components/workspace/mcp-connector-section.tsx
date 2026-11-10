'use client';
import { userError } from '@/lib/user-error';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FunctionReturnType } from 'convex/server';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Check, Copy, ExternalLink, LoaderCircle, ChevronDown } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from './primary-button';
import { claudeCodeCommand, MCP_APPS, type McpAppId } from './mcp-apps';
import { SettingsBody, SettingsCard } from '@/components/dashboard/settings-card';
import './mcp-connector-section.css';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

function CopyField({ label, value, pill = false }: { label: string; value: string; pill?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return <div className="mcp-copy-field"><code aria-label={label}>{value}</code><Button variant={pill ? 'soft' : 'outline'} size={pill ? 'sm' : 'md'} type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</Button></div>;
}

const when = (time?: number) => time ? new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

type AppId = McpAppId;
const APPS = MCP_APPS;

type Connector = FunctionReturnType<typeof api.mcpAuth.connector>;

/** The connect buttons, live connections and the link for other apps: shared by the Settings card and the dialog. `pill`: the dashboard's soft pills, for Settings. */
function ConnectorBody({ connector, onPick, pill = false }: { connector: Connector; onPick: (app: AppId) => void; pill?: boolean }) {
  const createToken = useMutation(api.mcpAuth.createPersonalToken);
  const revoke = useMutation(api.mcpAuth.revokeConnection);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function run(key: string, work: () => Promise<void>) {
    setBusy(key); setError('');
    try { await work(); } catch (cause) { setError(userError(cause, 'Could not update the connection. Please try again.')); }
    finally { setBusy(''); }
  }
  const variant = pill ? 'soft' as const : 'outline' as const, size = pill ? 'sm' as const : 'md' as const;
  const known = (label: string) => (['claude', 'chatgpt'] as const).some(id => APPS[id].match!.test(label));
  const connected = (app: AppId) => connector.connections.some(connection => connection.kind !== 'personal' && (APPS[app].match ? APPS[app].match.test(connection.label) : !known(connection.label)));
  return <>
    <div className="mcp-apps">
      {(Object.keys(APPS) as AppId[]).map(id => {
        const { name, Logo } = APPS[id];
        return <Button variant={variant} size={size} key={id} type="button" onClick={() => onPick(id)}><Logo width={16} height={16} /><span>Connect {name}</span>{connected(id) && <small><Check size={12} />Connected</small>}</Button>;
      })}
    </div>
    {connector.connections.length > 0 && <ul className="mcp-connections">
      {connector.connections.map(connection => <li key={connection.grantId}><div><span>{connection.label}</span><small>{connection.kind === 'personal' ? 'Personal token' : 'App'} · added {when(connection.createdAt)} · last used {when(connection.lastUsedAt)}</small></div>
        <Button variant={variant} size={size} type="button" disabled={!!busy} onClick={() => void run(connection.grantId, async () => { await revoke({ grantId: connection.grantId }); })}>{!pill && busy === connection.grantId && <LoaderCircle size={12} className="animate-spin" />}Revoke</Button></li>)}
    </ul>}
    <Collapsible className="mcp-advanced group/collapsible"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm">Other apps and scripts<ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent>
      <p>Any MCP client can use this link and sign in to Revline. Scripts can use a personal token as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
      <CopyField label="MCP server URL" value={connector.mcpUrl} pill={pill} />
      {token ? <><CopyField label="New personal token" value={token} pill={pill} /><p>Copy it now; it won&apos;t be shown again.</p></>
        : pill ? <Button variant="soft" size="sm" type="button" disabled={!!busy} onClick={() => void run('create', async () => setToken((await createToken({ label: 'Personal token' })).token))}>Create personal token</Button>
        : <PrimaryButton size="compact" disabled={!!busy} onClick={() => void run('create', async () => setToken((await createToken({ label: 'Personal token' })).token))}>{busy === 'create' && <LoaderCircle size={13} className="animate-spin" />}Create personal token</PrimaryButton>}
    </CollapsibleContent></Collapsible>
    {error && <p className="workspace-inline-error" role="alert">{error}</p>}
  </>;
}

/** How to add Revline to one app: copy the link, then paste it in that app's settings. */
function AppSteps({ id, mcpUrl }: { id: AppId; mcpUrl: string }) {
  const app = APPS[id];
  return <>
    <DialogDescription>Two steps, once. After that {app.owner} can open and edit your Revline projects.</DialogDescription>
    <ol className="mcp-dialog-steps">
      <li><strong>Copy your Revline link</strong><CopyField label="Revline MCP link" value={mcpUrl} /></li>
      <li><strong>Add it in {app.owner}</strong><p>{app.steps}</p>
        {app.settingsUrl && <Button asChild variant="outline" size="md"><a className="mcp-open-link" href={app.settingsUrl} target="_blank" rel="noreferrer">{app.settingsLabel}<ExternalLink size={13} /></a></Button>}</li>
    </ol>
    {id === 'claude' && <Collapsible className="mcp-advanced group/collapsible"><CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm">Using Claude Code?<ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent><CopyField label="Claude Code command" value={claudeCodeCommand(mcpUrl)} /><p>Then run <code>/mcp</code> in Claude Code to sign in.</p></CollapsibleContent></Collapsible>}
  </>;
}

function AppTitle({ id, onBack }: { id: AppId; onBack?: () => void }) {
  const { name, Logo } = APPS[id];
  return <div className="mcp-dialog-title">{onBack && <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to apps" onClick={onBack}><ArrowLeft size={15} /></Button>}<Logo width={22} height={22} /><DialogTitle>Connect {name}</DialogTitle></div>;
}

/** Pro: connect Claude, ChatGPT or any MCP agent to edit projects with the editor's own tools. */
export function McpConnectorSection() {
  const { isAuthenticated } = useConvexAuth();
  const connector = useQuery(api.mcpAuth.connector, isAuthenticated ? {} : 'skip');
  const [open, setOpen] = useState<AppId | null>(null);
  if (!connector?.allowed) return null;
  return <SettingsCard id="mcp" title="Connect AI apps" className="mcp-connector">
    <SettingsBody><ConnectorBody connector={connector} onPick={setOpen} pill /></SettingsBody>
    <Dialog open={!!open} onOpenChange={next => { if (!next) setOpen(null); }}>
      {open && <DialogContent className="workspace-dialog mcp-dialog"><AppTitle id={open} /><AppSteps id={open} mcpUrl={connector.mcpUrl} /></DialogContent>}
    </Dialog>
  </SettingsCard>;
}

/** The same connector as a dialog, opened from anywhere (the editor bar's MCP button): picking an app shows its steps in place. */
export function McpConnectorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { isAuthenticated } = useConvexAuth();
  const connector = useQuery(api.mcpAuth.connector, isAuthenticated && open ? {} : 'skip');
  const [app, setApp] = useState<AppId | null>(null);
  useEffect(() => { if (!open) setApp(null); }, [open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="workspace-dialog mcp-dialog">
    {app && connector?.allowed ? <><AppTitle id={app} onBack={() => setApp(null)} /><AppSteps id={app} mcpUrl={connector.mcpUrl} /></> : <>
      <DialogTitle>Connect AI apps</DialogTitle>
      <DialogDescription>Bring your own agent: edit your Revline projects from Claude, ChatGPT or any MCP app.</DialogDescription>
      {connector === undefined ? <LoaderCircle size={16} className="animate-spin mcp-dialog-loading" />
        : connector.allowed ? <ConnectorBody connector={connector} onPick={setApp} />
        : <p className="mcp-dialog-locked">Connecting AI apps is included with Pro. <Link href="/billing" onClick={() => onOpenChange(false)}>See plans</Link></p>}
    </>}
  </DialogContent></Dialog>;
}
