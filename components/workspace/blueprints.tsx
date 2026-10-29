'use client';
import { useMemo, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BlueprintPlayer } from './blueprint-player';
import './blueprints.css';

type Blueprint = FunctionReturnType<typeof api.blueprints.mine>[number];
type Part = Blueprint['parts'][number];

/** Sizes a blueprint is shown at: the screen's own size, then the common desktop and laptop sizes. */
const sizesOf = (blueprint: Blueprint) => [
  { key: 'original', label: 'Original', width: blueprint.width, height: blueprint.height },
  { key: 'desktop', label: 'Desktop', width: 1920, height: 1080 },
  { key: 'laptop', label: 'Laptop', width: 1440, height: 900 },
].filter((size, index, all) => all.findIndex(other => other.width === size.width && other.height === size.height) === index);

const pct = (value: number) => `${value.toFixed(1)}%`;

export function Blueprints({ items }: { items: Blueprint[] }) {
  return <section className="brand-kit-section">
    <div className="brand-kit-section-head"><h3>Blueprints{items.length ? ` (${items.length})` : ''}</h3></div>
    {items.length ? <div className="blueprints">{items.map(item => <BlueprintCard key={item.id} blueprint={item} />)}</div>
      : <p className="brand-kit-muted">No blueprints yet. The assistant rebuilds your product screens as live components and saves them here, with how closely each one matches.</p>}
  </section>;
}

function BlueprintCard({ blueprint }: { blueprint: Blueprint }) {
  const sizes = sizesOf(blueprint), [sizeKey, setSizeKey] = useState('original');
  const size = sizes.find(item => item.key === sizeKey) ?? sizes[0], original = size.key === 'original';
  const check = blueprint.checks.find(item => item.width === size.width && item.height === size.height);
  const [reveal, setReveal] = useState(50), [hovered, setHovered] = useState<string | null>(null), [focus, setFocus] = useState<Part | null>(null);
  const groups = useMemo(() => {
    const byName = new Map<string, Part[]>();
    for (const part of blueprint.parts) byName.set(part.name, [...byName.get(part.name) ?? [], part]);
    return [...byName].map(([name, parts]) => {
      const scored = parts.filter(part => part.score !== undefined);
      return { name, parts, score: scored.length ? scored.reduce((sum, part) => sum + part.score!, 0) / scored.length : null };
    }).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  }, [blueprint.parts]);
  // Zooming into one part: scale the stage so the part fills about 80% of it.
  const zoom = original && focus ? Math.min(blueprint.width / focus.width, blueprint.height / focus.height) * .8 : 1;
  const zoomOrigin = focus ? `${((focus.x + focus.width / 2) / blueprint.width) * 100}% ${((focus.y + focus.height / 2) / blueprint.height) * 100}%` : 'center';
  const highlighted = original ? blueprint.parts.filter(part => part.name === hovered || part === focus) : [];
  return <article className="blueprint">
    <header className="blueprint-head">
      <div><h4>{blueprint.name}</h4><span>Rebuilt from the {blueprint.screen} screen</span></div>
      <span className={`blueprint-score ${check ? '' : 'unchecked'}`}>{check ? `${pct(check.score)} match at ${check.width}×${check.height}` : `Not checked at ${size.width}×${size.height}`}</span>
    </header>
    <Tabs value={size.key} onValueChange={value => { setSizeKey(value); setFocus(null); }}>
      <TabsList>{sizes.map(item => <TabsTrigger key={item.key} value={item.key}>{item.label} · {item.width}×{item.height}</TabsTrigger>)}</TabsList>
    </Tabs>
    <div className="blueprint-stage" onClick={() => setFocus(null)}>
      <div className="blueprint-zoom" style={{ transform: `scale(${zoom})`, transformOrigin: zoomOrigin }}>
        <BlueprintPlayer code={blueprint.code} brand={blueprint.brand} width={size.width} height={size.height} />
        {original && blueprint.screenUrl && <img className="blueprint-screen" src={blueprint.screenUrl} alt={`The ${blueprint.screen} screen`} style={{ clipPath: `inset(0 0 0 ${reveal}%)` }} />}
        {highlighted.map((part, index) => <span key={index} className="blueprint-box" style={{ left: `${part.x / blueprint.width * 100}%`, top: `${part.y / blueprint.height * 100}%`, width: `${part.width / blueprint.width * 100}%`, height: `${part.height / blueprint.height * 100}%` }} />)}
        {original && blueprint.screenUrl && <span className="blueprint-divider" style={{ left: `${reveal}%` }} />}
      </div>
    </div>
    {original && blueprint.screenUrl && <label className="blueprint-reveal"><span>Rebuild</span><input type="range" min={0} max={100} value={reveal} onChange={event => setReveal(Number(event.target.value))} aria-label="Compare the rebuild with the screenshot" /><span>Screenshot</span></label>}
    <div className="blueprint-details">
      <div>
        <h5>Parts</h5>
        <ul className="blueprint-parts">{groups.map(group => <li key={group.name}>
          <button type="button" disabled={!original} onMouseEnter={() => setHovered(group.name)} onMouseLeave={() => setHovered(null)} onClick={event => { event.stopPropagation(); setFocus(focus?.name === group.name ? null : group.parts[0]); }} aria-pressed={focus?.name === group.name}>
            <span>{group.name}{group.parts.length > 1 ? ` ×${group.parts.length}` : ''}</span>{group.score !== null && <span className={group.score < 80 ? 'low' : ''}>{pct(group.score)}</span>}
          </button>
        </li>)}</ul>
      </div>
      <div>
        <h5>How it was measured</h5>
        <ul className="blueprint-colors">{blueprint.colors.map(color => <li key={color.label}><span style={{ background: color.hex }} /><strong>{color.label}</strong><code>{color.hex}</code><small>at {color.x}, {color.y}</small></li>)}</ul>
        <ul className="blueprint-edges">{blueprint.edges.map(edge => <li key={edge.label}><span>{edge.label}</span><code>{edge.axis} = {edge.at}px</code></li>)}</ul>
      </div>
    </div>
  </article>;
}
