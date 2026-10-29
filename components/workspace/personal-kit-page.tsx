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
type Topic = 'captions' | 'platforms' | 'editing';

const TOPICS: { topic: Topic; title: string; hint: string; example: string }[] = [
  { topic: 'captions', title: 'Captions and subtitles', hint: 'How your captions look, where they sit and how they read.', example: 'White bold captions, 2 to 4 words at a time, lower third.' },
  { topic: 'platforms', title: 'Platforms', hint: 'Where you post, and what that means for format, length and hooks.', example: 'Posts 9:16 to TikTok and Reels. Keep it under 45 seconds.' },
  { topic: 'editing', title: 'Editing', hint: 'Pacing, cuts, color, audio and anything else you always want.', example: 'Tight cuts, no dead air, no sound effects.' },
];

/** What the editing AI remembers about how you edit, grouped like a kit; everything is editable in place. */
export function PersonalKitPage() {
  const { isAuthenticated } = useConvexAuth();
  const memories = useQuery(api.memories.list, isAuthenticated ? {} : 'skip');
  const styles = memories?.filter(item => item.kind === 'style') ?? [];
  return <div className="workspace-page brand-kits-page"><WorkspaceNav title="Personal kit" active="personal-kit" />
    <main className="brand-kits-content">
      <header className="brand-kits-heading"><h1>Personal kit</h1><p>How you like your videos edited. The AI follows this in every project and adds to it as you work. Edit anything here; the next edit uses it.</p></header>
      {memories === undefined ? <Skeleton className="brand-kit-skeleton" /> : <>
        {TOPICS.map(section => <TopicCard key={section.topic} {...section} items={memories.filter(item => item.kind !== 'style' && (item.topic ?? 'editing') === section.topic)} />)}
        <article className="brand-kit personal-kit-card">
          <div className="personal-kit-head"><h2>Saved styles</h2><p>Edits you liked, saved with the exact settings so the AI can redo them anywhere. Ask for one by name, like “my podcast captions”.</p></div>
          {styles.length ? <ul className="personal-kit-list">{styles.map(item => <MemoryRow key={item.memoryId} item={item} />)}</ul>
            : <p className="brand-kit-muted">None yet. When the AI nails a look, tell it you love it and it saves the recipe here.</p>}
        </article>
      </>}
    </main>
  </div>;
}

function TopicCard({ topic, title, hint, example, items }: { topic: Topic; title: string; hint: string; example: string; items: Memory[] }) {
  const add = useMutation(api.memories.add);
  const [adding, setAdding] = useState(false), [text, setText] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const close = () => { setAdding(false); setText(''); setError(''); };
  const save = async () => { setSaving(true); setError(''); try { await add({ topic, text }); close(); } catch (failure) { setError(userError(failure, 'Could not save.')); } finally { setSaving(false); } };
  return <article className="brand-kit personal-kit-card">
    <div className="personal-kit-head"><h2>{title}</h2><p>{hint}</p></div>
    {items.length > 0 && <ul className="personal-kit-list">{items.map(item => <MemoryRow key={item.memoryId} item={item} />)}</ul>}
    {adding ? <div className="brand-kit-form">
      <Textarea autoFocus className="personal-kit-input" value={text} placeholder={example} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void save(); } }} />
      {error && <p className="brand-kit-error" role="alert">{error}</p>}
      <div className="brand-kit-actions"><Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving}>Cancel</Button><Button type="button" size="sm" onClick={() => void save()} disabled={saving || text.trim().length < 3}>{saving ? 'Saving…' : 'Save'}</Button></div>
    </div> : <>
      {!items.length && <p className="brand-kit-muted">Nothing yet. Add it here, or tell the AI while you edit.</p>}
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
