'use client';
import { useState } from 'react';
import { useQuery } from 'convex/react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/** The live links of one batch as a checklist to paste into Content Rewards, which has no API to submit them. */
export function BatchLinks({ batchId }: { batchId: Id<'postingBatches'> }) {
  const batch = useQuery(api.posting.batchLinks, { batchId });
  const [done, setDone] = useState<Set<string>>(() => new Set()), [copied, setCopied] = useState<string | null>(null);
  if (!batch) return <p className="posting-hint" role="status">Loading links…</p>;
  if (!batch.links.length) return <p className="posting-hint">Links appear here as each post goes live ({batch.total} {batch.total === 1 ? 'post' : 'posts'} in this batch).</p>;
  async function copy(id: string, text: string) { try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(null); } }
  return <>
    <p className="posting-hint">Paste these links into Content Rewards to submit them to the campaign. {batch.links.length} of {batch.total} live.</p>
    <ul className="posting-links">{batch.links.map(link => <li key={link.postId}>
      <Checkbox aria-label={`Submitted ${link.url}`} checked={done.has(link.postId)} onCheckedChange={checked => setDone(previous => { const next = new Set(previous); if (checked === true) next.add(link.postId); else next.delete(link.postId); return next; })} />
      <a href={link.url} target="_blank" rel="noopener noreferrer">{PLATFORM_NAMES[link.platform]} · @{link.username} · {link.url}</a>
      <Button variant="outline" size="sm" onClick={() => void copy(link.postId, link.url)}>{copied === link.postId ? <Check size={12} /> : <Copy size={12} />}{copied === link.postId ? 'Copied' : 'Copy'}</Button>
    </li>)}</ul>
    <Button variant="outline" size="md" onClick={() => void copy('all', batch.links.map(link => link.url).join('\n'))}>{copied === 'all' ? <Check size={12} /> : <Copy size={12} />}{copied === 'all' ? 'Copied all links' : 'Copy all links'}</Button>
  </>;
}
