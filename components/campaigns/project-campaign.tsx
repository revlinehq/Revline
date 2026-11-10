'use client';
// The project's campaign. In the editor's top bar (placement "header") it is a chip beside the project name, with a
// popover to change or remove it. Above the composer it is the question asked when a match was unclear: up to three
// campaigns to pick from. Each placement renders nothing when it has nothing to show.
import { useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ChevronDown, Megaphone, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { CampaignView } from '@/convex/campaignsModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dismissCampaignOffer, useCampaignOffer } from './campaign-match';
import './project-campaign.css';

const NO_RING = 'focus-visible:ring-0';
const rate = (campaign: CampaignView) => campaign.maxRateCents ? `$${(campaign.maxRateCents / 100).toFixed(2)} per 1,000 views` : null;

export function ProjectCampaign({ projectId, placement = 'composer' }: { projectId: Id<'projects'>; placement?: 'composer' | 'header' }) {
  const link = useQuery(api.campaigns.forProject, { projectId });
  const offer = useCampaignOffer(projectId);
  const attach = useMutation(api.campaigns.attachProject), detach = useMutation(api.campaigns.detachProject);
  const search = useAction(api.campaignsSearch.search);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CampaignView[] | null>(null);
  const [error, setError] = useState('');
  const pick = (campaignId: Id<'campaigns'>) => {
    setError('');
    void attach({ projectId, campaignId }).then(() => { dismissCampaignOffer(projectId); setOpen(false); setQuery(''); setResults(null); }).catch(() => setError('Could not set the campaign. Try again.'));
  };
  const find = () => {
    setError('');
    void search({ text: query, limit: 5 }).then(found => setResults(found.campaigns.map(entry => entry.campaign))).catch(() => setError('Could not search campaigns. Try again.'));
  };
  const campaign = link?.campaign;
  const header = placement === 'header';
  // The attached campaign lives in the top bar; the composer keeps only the question.
  if (header ? !campaign : !!campaign || !offer.length) return null;
  const remove = () => { setError(''); void detach({ projectId }).then(() => { setOpen(false); setQuery(''); setResults(null); }).catch(() => setError('Could not remove the campaign. Try again.')); };
  return <div className={header ? 'project-campaign-chip flex min-w-0 items-center' : 'mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground'} data-project-campaign={placement}>
    {campaign ? <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button type="button" data-slot="button" variant="soft" size="sm" className={`project-campaign-trigger min-w-0 shrink ${NO_RING}`} title="Change campaign"><Megaphone aria-hidden="true"/><span className="truncate">{campaign.name}</span><ChevronDown aria-hidden="true"/></Button></PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="campaign-popover w-80">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{campaign.name}</span>
            <span className="text-xs text-muted-foreground">{[campaign.organization?.name, rate(campaign), campaign.ended ? 'Ended' : null].filter(Boolean).join(' · ')}</span>
            <span className="text-xs text-muted-foreground">{link?.how === 'matched' ? 'Matched from your message. ' : ''}Tags this project in Revline. It does not join the campaign on Content Rewards.</span>
          </div>
          <form className="flex gap-1.5" onSubmit={event => { event.preventDefault(); find(); }}>
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find another campaign" aria-label="Find another campaign" className={NO_RING}/>
            <Button type="submit" variant="secondary" size="md" className={NO_RING}>Search</Button>
          </form>
          {results && (results.length ? <div className="flex flex-col gap-1">{results.map(result => <Button key={result._id} type="button" variant="ghost" size="sm" className={`h-auto justify-start py-1.5 text-left whitespace-normal ${NO_RING}`} onClick={() => pick(result._id)}>
            <span className="flex min-w-0 flex-col"><span className="truncate">{result.name}</span><span className="truncate text-xs text-muted-foreground">{[result.organization?.name, rate(result)].filter(Boolean).join(' · ')}</span></span>
          </Button>)}</div> : <span className="text-xs text-muted-foreground">No campaigns found.</span>)}
          <Button type="button" variant="ghost" size="sm" className={`justify-start ${NO_RING}`} onClick={remove}><X aria-hidden="true"/>Remove campaign</Button>
          {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </PopoverContent>
      </Popover>
    </> : <>
      <span>Which campaign is this for?</span>
      {offer.map(choice => <Button key={choice._id} type="button" variant="outline" size="xs" className={`max-w-full min-w-0 shrink rounded-full ${NO_RING}`} title={[choice.organization?.name, rate(choice)].filter(Boolean).join(' · ')} onClick={() => pick(choice._id)}><span className="truncate">{choice.name}</span></Button>)}
      <Button type="button" variant="ghost" size="icon-xs" className={`rounded-full ${NO_RING}`} aria-label="Not for a campaign" title="Not for a campaign" onClick={() => { dismissCampaignOffer(projectId); void detach({ projectId }).catch(() => {}); }}><X aria-hidden="true"/></Button>
    </>}
    {!campaign && error && <span role="alert" className="text-destructive">{error}</span>}
  </div>;
}
