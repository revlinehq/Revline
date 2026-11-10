'use client';
// "Make clips" for a campaign: paste the link to its instructions, then start a project attached to the
// campaign and open the AI Editor with the link waiting in the composer, not sent.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { ExternalLink, Link2, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { CampaignView } from '@/convex/campaignsModel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { editorDraftKey, storeDraftText } from '@/lib/editor/opening-request';
import { userError } from '@/lib/user-error';

const STEPS = ['Open the campaign on Content Rewards and join it.', 'Copy the link to its instructions document.', 'Paste the link here.'];
/** True once the pasted text holds a link: a host with a dot, with or without https://, anywhere in it. */
const holdsLink = (value: string) => /(^|\s)(https?:\/\/)?[^\s/.:]+(\.[^\s/.:]+)+(\/\S*)?/i.test(value);

export function GetClipsDialog({ campaign, open, onOpenChange }: { campaign: CampaignView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const createProject = useMutation(api.projects.create), attachProject = useMutation(api.campaigns.attachProject);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A project made by a first try is reused, so a retry after a failed attach does not leave a second one behind.
  const created = useRef<Id<'projects'> | null>(null);
  const ready = holdsLink(link);
  async function makeClips() {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try {
      const projectId = created.current ??= await createProject({ title: campaign.name, aspectRatio: 'vertical' });
      await attachProject({ projectId, campaignId: campaign._id });
      try { storeDraftText(editorDraftKey(projectId), link.trim()); } catch { /* Without session storage the editor opens with an empty composer. */ }
      router.push(`/editor/${projectId}`);
    } catch (reason) { setError(userError(reason, 'Could not start your clips. Try again.')); setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="get-clips-dialog">
      <DialogTitle>Get the campaign&apos;s instructions</DialogTitle>
      <DialogDescription>This campaign is on Content Rewards. The rules and the footage are in a document you get after joining there.</DialogDescription>
      <ol className="get-clips-steps">{STEPS.map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
      <form className="get-clips-form" onSubmit={event => { event.preventDefault(); void makeClips(); }}>
        <div className="get-clips-field"><Link2 aria-hidden="true" /><Input aria-label="Paste the instructions link" placeholder="Paste the instructions link" value={link} maxLength={2000} onChange={event => { setLink(event.target.value); setError(''); }} disabled={busy} autoComplete="off" /></div>
        {error && <p className="get-clips-error" role="alert">{error}</p>}
        <div className="get-clips-actions">
          <Button asChild variant="soft"><a href={campaign.url} target="_blank" rel="noreferrer">Open Content Rewards<ExternalLink aria-hidden="true" /></a></Button>
          <Button type="submit" variant="primary" disabled={!ready || busy}>{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}Make clips</Button>
        </div>
      </form>
      <p className="get-clips-note">Revline reads the rules so your clips follow them.</p>
    </DialogContent>
  </Dialog>;
}
