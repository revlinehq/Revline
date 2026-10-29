'use client';
import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { Pencil, Plus, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceNav } from './workspace-nav';
import './brand-kits-page.css';
import './personal-kit-page.css';

type Memory = FunctionReturnType<typeof api.memories.list>[number];

/** What the editing AI remembers about how you edit, in one list; everything is editable in place. */
export function PersonalKitPage() {
  const { isAuthenticated } = useConvexAuth();
  const memories = useQuery(api.memories.list, isAuthenticated ? {} : 'skip');
  return <div className="workspace-page brand-kits-page"><WorkspaceNav title="Personal kit" active="personal-kit" />
    <main className="brand-kits-content">
      <header className="brand-kits-heading"><h1>Personal kit</h1><p>Your overall taste in editing. Revline uses this to reuse the facts without re-asking.</p></header>
      {memories === undefined ? <Skeleton className="brand-kit-skeleton" /> : <MemoryCard items={memories} />}
    </main>
  </div>;
}

function MemoryCard({ items }: { items: Memory[] }) {
  const add = useMutation(api.memories.add);
  const [adding, setAdding] = useState(false), [text, setText] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const close = () => { setAdding(false); setText(''); setError(''); };
  const save = async () => { setSaving(true); setError(''); try { await add({ text }); close(); } catch (failure) { setError(userError(failure, 'Could not save.')); } finally { setSaving(false); } };
  return <article className="brand-kit personal-kit-card">
    {items.length > 0 && <ul className="personal-kit-list">{items.map(item => <MemoryRow key={item.memoryId} item={item} />)}</ul>}
    {adding ? <div className="brand-kit-form">
      <Textarea autoFocus className="personal-kit-input" value={text} placeholder="White bold captions, 2 to 4 words at a time. Posts 9:16 to TikTok." onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void save(); } }} />
      {error && <p className="brand-kit-error" role="alert">{error}</p>}
      <div className="brand-kit-actions"><Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving}>Cancel</Button><Button type="button" size="sm" onClick={() => void save()} disabled={saving || text.trim().length < 3}>{saving ? 'Saving…' : 'Save'}</Button></div>
    </div> : <>
      {!items.length && <p className="brand-kit-muted">Nothing yet. Add it here, or tell the AI what you like while you edit. When it nails a look, say so and it saves the settings.</p>}
      <Button type="button" variant="ghost" size="sm" className="brand-kit-add" onClick={() => setAdding(true)}><Plus />Add</Button>
    </>}
  </article>;
}

function MemoryRow({ item }: { item: Memory }) {
  const edit = useMutation(api.memories.edit), remove = useMutation(api.memories.remove);
  const [editing, setEditing] = useState(false), [text, setText] = useState(item.text), [name, setName] = useState(item.name ?? '');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const open = () => { setText(item.text); setName(item.name ?? ''); setError(''); setEditing(true); };
  const save = async () => { setSaving(true); setError(''); try { await edit({ memoryId: item.memoryId, text, ...(item.kind === 'style' ? { name } : {}) }); setEditing(false); } catch (failure) { setError(userError(failure, 'Could not save.')); } finally { setSaving(false); } };
  const meta = [item.project && `Only in ${item.project}`, item.uses > 0 && `Used ${item.uses}×`].filter(Boolean).join(' · ');
  if (editing) return <li className="personal-kit-row editing"><div className="brand-kit-form">
    {item.kind === 'style' && <Input value={name} aria-label="Style name" onChange={event => setName(event.target.value)} />}
    <Textarea autoFocus className="personal-kit-input" value={text} aria-label="Memory" onChange={event => setText(event.target.value)} />
    {error && <p className="brand-kit-error" role="alert">{error}</p>}
    <div className="brand-kit-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button><Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>
  </div></li>;
  return <li className="personal-kit-row">
    <div className="personal-kit-text">
      {item.name && <strong>{item.name}</strong>}
      <span>{item.text}</span>
      {meta && <small>{meta}</small>}
      {item.recipe && <details><summary>Settings</summary><pre>{item.recipe}</pre></details>}
    </div>
    <div className="personal-kit-tools">
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${item.name ?? 'memory'}`} onClick={open}><Pencil /></Button>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Forget ${item.name ?? 'memory'}`} onClick={() => void remove({ memoryId: item.memoryId })}><X /></Button>
    </div>
  </li>;
}
