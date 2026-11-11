'use client';
// "Make clips" for a campaign: start a project attached to the campaign and open it in the AI Editor.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { userError } from '@/lib/user-error';

export function MakeClipsButton({ campaignId, name, variant, onError }: { campaignId: Id<'campaigns'>; name: string; variant: 'primary' | 'soft'; onError: (message: string) => void }) {
  const router = useRouter();
  const createProject = useMutation(api.projects.create), attachProject = useMutation(api.campaigns.attachProject);
  const [busy, setBusy] = useState(false);
  // A project made by a first try is reused, so a retry after a failed attach does not leave a second one behind.
  const created = useRef<Id<'projects'> | null>(null);
  async function makeClips() {
    if (busy) return;
    setBusy(true); onError('');
    try {
      const projectId = created.current ??= await createProject({ title: name, aspectRatio: 'vertical' });
      await attachProject({ projectId, campaignId });
      router.push(`/editor/${projectId}`);
    } catch (reason) { onError(userError(reason, 'Could not start your clips. Try again.')); setBusy(false); }
  }
  return <Button variant={variant} disabled={busy} onClick={() => void makeClips()}>Make clips</Button>;
}
