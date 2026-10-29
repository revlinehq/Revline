'use client';
import { useState, type ReactNode } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ArrowUpRight, Pencil, Plus, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { standaloneSvg } from '@/lib/editor/brand-kit';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceNav } from './workspace-nav';
import './brand-kits-page.css';

type Kit = FunctionReturnType<typeof api.brandKits.mine>[number];
type Motion = NonNullable<Kit['motion']>;
const PERSONALITIES = ['premium', 'corporate', 'energetic', 'playful'] as const;

/** What the AI works with for each brand; every section is editable in place. */
export function BrandKitsPage() {
  const { isAuthenticated } = useConvexAuth();
  const kits = useQuery(api.brandKits.mine, isAuthenticated ? {} : 'skip');
  return <div className="workspace-page brand-kits-page"><WorkspaceNav title="Brand kits" active="brand-kits" />
    <main className="brand-kits-content">
      <header className="brand-kits-heading"><h1>Brand kits</h1><p>What the AI works with when it makes videos for your brands. Edit anything here; the next video uses it.</p></header>
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

/** An editable list of short text rows with add and remove. */
function ListEditor({ values, onChange, placeholder, max }: { values: string[]; onChange: (values: string[]) => void; placeholder: string; max: number }) {
  return <div className="brand-kit-list-editor">
    {values.map((value, index) => <div key={index} className="brand-kit-row"><Input value={value} placeholder={placeholder} onChange={event => onChange(values.map((item, at) => at === index ? event.target.value : item))} /><Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => onChange(values.filter((_, at) => at !== index))}><X /></Button></div>)}
    {values.length < max && <Button type="button" variant="ghost" size="sm" className="brand-kit-add" onClick={() => onChange([...values, ''])}><Plus />Add</Button>}
  </div>;
}

const contextOf = (kit: Kit) => ({ product: kit.context?.product ?? '', problem: kit.context?.problem ?? '', audience: kit.context?.audience ?? '', features: kit.context?.features ?? [] });

function BrandKitCard({ kit }: { kit: Kit }) {
  const update = useMutation(api.brandKits.updateKit), removeScreen = useMutation(api.brandKits.removeScreen);
  const kitId = kit.id as Id<'brandKits'>;
  const [editing, setEditing] = useState<'name' | 'colors' | 'context' | 'motion' | null>(null);
  const [name, setName] = useState(kit.name);
  const [colors, setColors] = useState(kit.colors);
  const [context, setContext] = useState(contextOf(kit));
  const [motion, setMotion] = useState<Motion>(kit.motion ?? { personality: 'premium', ease: 'power2.out', durations: { short: 0.6, medium: 0.9, long: 1.4 }, entrance: '' });
  const open = (section: NonNullable<typeof editing>) => { setName(kit.name); setColors(kit.colors); setContext(contextOf(kit)); if (kit.motion) setMotion(kit.motion); setEditing(section); };
  const close = () => setEditing(null);
  const logo = kit.logo ? (kit.logo.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(standaloneSvg(kit.logo))}` : kit.logo) : null;
  return <article className="brand-kit">
    <header className="brand-kit-header">
      {logo && <span className="brand-kit-logo">{kit.logo?.startsWith('<svg') ? <span className="brand-kit-mark" style={{ maskImage: `url("${logo}")`, WebkitMaskImage: `url("${logo}")` }} /> : <img src={logo} alt="" />}</span>}
      {editing === 'name' ? <div className="brand-kit-name-edit"><Input value={name} onChange={event => setName(event.target.value)} aria-label="Kit name" /><Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button><Button type="button" size="sm" onClick={() => void update({ kitId, name }).then(close)}>Save</Button></div>
        : <div><div className="brand-kit-title"><h2>{kit.name}</h2><Button type="button" variant="ghost" size="icon-xs" aria-label="Rename kit" onClick={() => open('name')}><Pencil /></Button></div>{kit.sourceUrl && <a href={kit.sourceUrl} target="_blank" rel="noreferrer">{new URL(kit.sourceUrl).host}<ArrowUpRight size={12} /></a>}</div>}
      <span className="brand-kit-updated">Updated {new Date(kit.updatedAt).toLocaleDateString()}</span>
    </header>
    <div className="brand-kit-grid">
      <Editable title="Colors" editing={editing === 'colors'} onEdit={() => open('colors')} onCancel={close} onSave={async () => { await update({ kitId, colors }); close(); }}
        form={<div className="brand-kit-list-editor">{colors.map((color, index) => <div key={index} className="brand-kit-row"><span className="brand-kit-swatch" style={{ background: color.value }} /><Input value={color.name} aria-label="Color name" onChange={event => setColors(colors.map((item, at) => at === index ? { ...item, name: event.target.value } : item))} /><Input value={color.value} aria-label="Color value" onChange={event => setColors(colors.map((item, at) => at === index ? { ...item, value: event.target.value } : item))} /><Button type="button" variant="ghost" size="icon-xs" aria-label="Remove color" onClick={() => setColors(colors.filter((_, at) => at !== index))}><X /></Button></div>)}{colors.length < 16 && <Button type="button" variant="ghost" size="sm" className="brand-kit-add" onClick={() => setColors([...colors, { name: '', value: '#' }])}><Plus />Add color</Button>}</div>}>
        <ul className="brand-kit-colors">{kit.colors.map(color => <li key={color.name}><span style={{ background: color.value }} /><strong>{color.name}</strong><code>{color.value}</code></li>)}</ul>
      </Editable>
      <section className="brand-kit-section"><div className="brand-kit-section-head"><h3>Fonts</h3></div>
        <ul className="brand-kit-fonts">{kit.fonts.map(font => <li key={`${font.family}:${font.role}`}><span className="brand-kit-font-sample">{font.family}</span><span>{font.role} · {font.weights.join(', ')}</span></li>)}</ul>
      </section>
      <Editable title="Brand context" editing={editing === 'context'} onEdit={() => open('context')} onCancel={close} onSave={async () => { await update({ kitId, context }); close(); }}
        form={<div className="brand-kit-fields"><label>Product<Textarea value={context.product} onChange={event => setContext({ ...context, product: event.target.value })} /></label><label>Problem<Textarea value={context.problem} onChange={event => setContext({ ...context, problem: event.target.value })} /></label><label>Audience<Input value={context.audience} onChange={event => setContext({ ...context, audience: event.target.value })} /></label><div className="brand-kit-field">Features<ListEditor values={context.features} max={8} placeholder="A feature worth showing" onChange={features => setContext({ ...context, features })} /></div></div>}>
        {kit.context ? <dl className="brand-kit-facts">
          {kit.context.product && <><dt>Product</dt><dd>{kit.context.product}</dd></>}
          {kit.context.problem && <><dt>Problem</dt><dd>{kit.context.problem}</dd></>}
          {kit.context.audience && <><dt>Audience</dt><dd>{kit.context.audience}</dd></>}
          {kit.context.features?.length ? <><dt>Features</dt><dd><ul className="brand-kit-features">{kit.context.features.map(feature => <li key={feature}>{feature}</li>)}</ul></dd></> : null}
        </dl> : <p className="brand-kit-muted">Not confirmed yet. The assistant drafts it from your site before the first launch video, or add it here.</p>}
      </Editable>
      <Editable title="Motion" editing={editing === 'motion'} onEdit={() => open('motion')} onCancel={close} onSave={async () => { await update({ kitId, motion }); close(); }}
        form={<div className="brand-kit-fields"><label>Personality<Select value={motion.personality} onValueChange={value => setMotion({ ...motion, personality: value as Motion['personality'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PERSONALITIES.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label><label>Signature ease<Input value={motion.ease} onChange={event => setMotion({ ...motion, ease: event.target.value })} /></label><div className="brand-kit-field">Durations (seconds)<div className="brand-kit-row">{(['short', 'medium', 'long'] as const).map(key => <Input key={key} type="number" step="0.05" min="0.1" aria-label={`${key} duration`} value={motion.durations[key]} onChange={event => setMotion({ ...motion, durations: { ...motion.durations, [key]: Number(event.target.value) } })} />)}</div></div><label>Entrance<Input value={motion.entrance} onChange={event => setMotion({ ...motion, entrance: event.target.value })} /></label></div>}>
        {kit.motion ? <dl className="brand-kit-facts"><dt>Personality</dt><dd>{kit.motion.personality}</dd><dt>Signature ease</dt><dd><code>{kit.motion.ease}</code></dd><dt>Durations</dt><dd>{kit.motion.durations.short}s · {kit.motion.durations.medium}s · {kit.motion.durations.long}s</dd><dt>Entrance</dt><dd>{kit.motion.entrance}</dd></dl>
          : <p className="brand-kit-muted">Not set. The assistant proposes one with your first film's style, or set it here.</p>}
      </Editable>
    </div>
    <section className="brand-kit-section">
      <div className="brand-kit-section-head"><h3>Screens{kit.screens.length ? ` (${kit.screens.length})` : ''}</h3></div>
      {kit.screens.length ? <ul className="brand-kit-screens">{kit.screens.map(screen => <li key={screen.name}><div className="brand-kit-screen"><img src={screen.url} alt={screen.note ?? screen.name} loading="lazy" /><Button type="button" variant="secondary" size="icon-xs" className="brand-kit-screen-remove" aria-label={`Remove ${screen.name}`} onClick={() => void removeScreen({ kitId, name: screen.name })}><X /></Button></div><strong>{screen.name}</strong>{screen.note && <span>{screen.note}</span>}</li>)}</ul>
        : <p className="brand-kit-muted">No product screens saved. Give the assistant screenshots of your product and ask it to save them to this kit; every later video for {kit.name} can use them.</p>}
    </section>
  </article>;
}
