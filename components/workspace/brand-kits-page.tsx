'use client';
import { useState, type ReactNode } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ArrowUpRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { standaloneSvg } from '@/lib/editor/brand-kit';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WorkspaceNav } from './workspace-nav';
import './brand-kits-page.css';

type Kit = FunctionReturnType<typeof api.brandKits.mine>[number];

/** What the AI works with for each brand; every section is editable in place. */
export function BrandKitsPage() {
  const { isAuthenticated } = useConvexAuth();
  const kits = useQuery(api.brandKits.mine, isAuthenticated ? {} : 'skip');
  return <div className="workspace-page brand-kits-page"><WorkspaceNav title="Brand kits" active="brand-kits" />
    <main className="brand-kits-content">
      <header className="brand-kits-heading"><h1>Brand kits</h1><p>What the AI works with when it makes videos for your brands.</p></header>
      {kits === undefined ? <Skeleton className="brand-kit-skeleton" /> : kits.length === 0 ? <section className="brand-kit-empty"><h2>No brand kits yet</h2><p>Ask the assistant for a launch or feature video and give it your website. It builds a kit from your site and saves it here.</p></section> : kits.map(kit => <BrandKitCard key={kit.id} kit={kit} />)}
    </main>
  </div>;
}

/** A section that switches between reading and editing with a pencil. */
function Editable({ title, editing, onEdit, onCancel, onSave, children, form }: { title: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => Promise<void>; children: ReactNode; form: ReactNode }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const save = async () => { setSaving(true); setError(''); try { await onSave(); } catch (failure) { setError(userError(failure, 'Could not save.')); } finally { setSaving(false); } };
  return <section className="brand-kit-section">
    <div className="brand-kit-section-head"><h3>{title}</h3>{!editing && <Button type="button" variant="ghost" size="icon-xs" aria-label={`Edit ${title.toLowerCase()}`} onClick={onEdit}><Pencil /></Button>}</div>
    {editing ? <div className="brand-kit-form">{form}{error && <p className="brand-kit-error" role="alert">{error}</p>}<div className="brand-kit-actions"><Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button><Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div></div> : children}
  </section>;
}

const contextOf = (kit: Kit) => ({ product: kit.context?.product ?? '' });

function BrandKitCard({ kit }: { kit: Kit }) {
  const update = useMutation(api.brandKits.updateKit), removeScreen = useMutation(api.brandKits.removeScreen);
  const kitId = kit.id as Id<'brandKits'>;
  const [editing, setEditing] = useState<'name' | 'colors' | 'context' | null>(null);
  const [name, setName] = useState(kit.name);
  const [colors, setColors] = useState(kit.colors);
  const [context, setContext] = useState(contextOf(kit));
  const open = (section: NonNullable<typeof editing>) => { setName(kit.name); setColors(kit.colors); setContext(contextOf(kit)); setEditing(section); };
  const close = () => setEditing(null);
  const logo = kit.logo ? (kit.logo.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(standaloneSvg(kit.logo))}` : kit.logo) : null;
  return <article className="brand-kit">
    <header className="brand-kit-header">
      {logo && <span className="brand-kit-logo">{kit.logo?.startsWith('<svg') ? <span className="brand-kit-mark" style={{ maskImage: `url("${logo}")`, WebkitMaskImage: `url("${logo}")` }} /> : <img src={logo} alt="" />}</span>}
      {editing === 'name' ? <div className="brand-kit-name-edit"><Input value={name} onChange={event => setName(event.target.value)} aria-label="Kit name" /><Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button><Button type="button" size="sm" onClick={() => void update({ kitId, name }).then(close)}>Save</Button></div>
        : <div><div className="brand-kit-title"><h2>{kit.name}</h2><Button type="button" variant="ghost" size="icon-xs" aria-label="Rename kit" onClick={() => open('name')}><Pencil /></Button></div>{kit.sourceUrl && <a href={kit.sourceUrl} target="_blank" rel="noreferrer">{new URL(kit.sourceUrl).host}<ArrowUpRight size={12} /></a>}</div>}
      <span className="brand-kit-updated">Updated {new Date(kit.updatedAt).toLocaleDateString()}</span>
      <DeleteKit kitId={kitId} name={kit.name} />
    </header>
    <div className="brand-kit-grid">
      <Editable title="Colors" editing={editing === 'colors'} onEdit={() => open('colors')} onCancel={close} onSave={async () => { await update({ kitId, colors }); close(); }}
        form={<div className="brand-kit-list-editor">{colors.map((color, index) => <div key={index} className="brand-kit-row"><span className="brand-kit-swatch" style={{ background: color.value }} /><Input value={color.name} aria-label="Color name" onChange={event => setColors(colors.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} /><Input value={color.value} aria-label="Color value" onChange={event => setColors(colors.map((item, at) => at === index ? { ...item, value: event.target.value } : item))} /><Button type="button" variant="ghost" size="icon-xs" aria-label="Remove color" onClick={() => setColors(colors.filter((_, at) => at !== index))}><X /></Button></div>)}{colors.length < 16 && <Button type="button" variant="ghost" size="sm" className="brand-kit-add" onClick={() => setColors([...colors, { name: '', value: '#' }])}><Plus />Add color</Button>}</div>}>
        <ul className="brand-kit-colors">{kit.colors.map(color => <li key={color.name}><span style={{ background: color.value }} /><strong>{color.name}</strong><code>{color.value}</code></li>)}</ul>
      </Editable>
      <section className="brand-kit-section"><div className="brand-kit-section-head"><h3>Fonts</h3></div>
        <ul className="brand-kit-fonts">{kit.fonts.map(font => <li key={`${font.family}:${font.role}`}><span className="brand-kit-font-sample">{font.family}</span><span>{font.role} · {font.weights.join(', ')}</span></li>)}</ul>
      </section>
      <Editable title="Product" editing={editing === 'context'} onEdit={() => open('context')} onCancel={close} onSave={async () => { await update({ kitId, context }); close(); }}
        form={<Textarea className="brand-kit-product-input" value={context.product} placeholder="What it is, the problem it solves, the features worth showing." onChange={event => setContext({ product: event.target.value })} />}>
        {kit.context?.product ? <p className="brand-kit-product">{kit.context.product}</p> : <p className="brand-kit-muted">Not confirmed yet. The assistant drafts it from your site before the first launch video, or write it here.</p>}
      </Editable>
    </div>
    <section className="brand-kit-section">
      <div className="brand-kit-section-head"><h3>Screens{kit.screens.length ? ` (${kit.screens.length})` : ''}</h3></div>
      {kit.screens.length ? <ul className="brand-kit-screens">{kit.screens.map(screen => <li key={screen.name}><strong>{screen.name}</strong><div className="brand-kit-screen"><img src={screen.url} alt={screen.note ?? screen.name} loading="lazy" /><Button type="button" variant="secondary" size="icon-xs" className="brand-kit-screen-remove" aria-label={`Remove ${screen.name}`} onClick={() => void removeScreen({ kitId, name: screen.name })}><X /></Button></div></li>)}</ul>
        : <p className="brand-kit-muted">No product screens saved. Give the assistant screenshots of your product and ask it to save them to this kit; every later video for {kit.name} can use them.</p>}
    </section>
  </article>;
}

/** The bin in a kit's corner; asks once before the kit and its files are gone. */
function DeleteKit({ kitId, name }: { kitId: Id<'brandKits'>; name: string }) {
  const remove = useMutation(api.brandKits.remove);
  const [open, setOpen] = useState(false), [deleting, setDeleting] = useState(false), [error, setError] = useState('');
  const confirm = async () => { setDeleting(true); setError(''); try { await remove({ kitId }); setOpen(false); } catch (failure) { setError(userError(failure, 'Could not delete the kit.')); } finally { setDeleting(false); } };
  return <>
    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Delete ${name}`} onClick={() => setOpen(true)}><Trash2 /></Button>
    <Dialog open={open} onOpenChange={open => { if (!deleting) setOpen(open); }}><DialogContent className="workspace-dialog">
      <DialogHeader><DialogTitle>Delete {name}?</DialogTitle><DialogDescription>Its colors, fonts, screens and blueprints are deleted. Videos already made keep their look.</DialogDescription></DialogHeader>
      {error && <p className="brand-kit-error" role="alert">{error}</p>}
      <DialogFooter><DialogClose asChild><Button type="button" variant="ghost" disabled={deleting}>Cancel</Button></DialogClose><Button type="button" variant="destructive" onClick={() => void confirm()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete kit'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
