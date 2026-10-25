'use client';
import { userError } from '@/lib/user-error';

import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { PrimaryButton } from './primary-button';
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

/** Ultra: connect Claude (or another MCP client) to edit projects with the editor's own tools. */
export function McpConnectorSection() {
  const { isAuthenticated } = useConvexAuth();
  const connector = useQuery(api.mcpAuth.connector, isAuthenticated ? {} : 'skip');
  const createToken = useMutation(api.mcpAuth.createPersonalToken);
  const revoke = useMutation(api.mcpAuth.revokeConnection);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!connector?.allowed) return null;

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key); setError('');
    try { await work(); } catch (cause) { setError(userError(cause, 'Could not update the connector. Please try again.')); }
    finally { setBusy(''); }
  }

  return <section className="workspace-profile-section mcp-connector"><div className="workspace-section-label"><h2>Claude connector</h2><p>Edit your projects from Claude with Revline's editing tools. Every edit is saved and undoable.</p></div>
    <div className="workspace-section-content">
      <div className="mcp-step"><strong>Server URL</strong><CopyField label="MCP server URL" value={connector.mcpUrl} />
        <p>In Claude, open Settings → Connectors → Add custom connector, paste this URL and sign in to Revline when asked.</p></div>
      <div className="mcp-step"><strong>Claude Code</strong><CopyField label="Claude Code command" value={`claude mcp add --transport http revline ${connector.mcpUrl}`} />
        <p>Then run <code>/mcp</code> in Claude Code to sign in. For scripts, use a personal token instead.</p></div>
      <div className="mcp-step"><strong>Personal tokens</strong>
        {token ? <><CopyField label="New personal token" value={token} /><p>Copy it now; it won&apos;t be shown again. Use it as <code>Authorization: Bearer &lt;token&gt;</code>, e.g. add <code>--header &quot;Authorization: Bearer &lt;token&gt;&quot;</code> to the command above.</p></>
          : <PrimaryButton size="compact" disabled={!!busy} onClick={() => void run('create', async () => setToken((await createToken({ label: 'Personal token' })).token))}>{busy === 'create' && <LoaderCircle size={13} className="animate-spin" />}Create token</PrimaryButton>}
      </div>
      {connector.connections.length > 0 && <div className="mcp-step"><strong>Connected</strong><ul className="mcp-connections">
        {connector.connections.map(connection => <li key={connection.grantId}><div><span>{connection.label}</span><small>{connection.kind === 'personal' ? 'Personal token' : 'App'} · added {when(connection.createdAt)} · last used {when(connection.lastUsedAt)}</small></div>
          <button type="button" className="workspace-outline-button" disabled={!!busy} onClick={() => void run(connection.grantId, async () => { await revoke({ grantId: connection.grantId }); })}>{busy === connection.grantId && <LoaderCircle size={12} className="animate-spin" />}Revoke</button></li>)}
      </ul></div>}
      {error && <p className="workspace-inline-error" role="alert">{error}</p>}
    </div>
  </section>;
}
