// "Make clips" for a campaign: opens the campaign on Content Rewards in a new tab, where the person joins it and gets its rules and footage.
import { Button } from '@/components/ui/button';

export function MakeClipsButton({ url, variant }: { url: string | undefined; variant: 'primary' | 'soft' }) {
  if (!url) return null;
  return <Button asChild variant={variant}><a href={url} target="_blank" rel="noopener noreferrer">Make clips</a></Button>;
}
