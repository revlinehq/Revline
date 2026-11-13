'use client';

import { useState } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { VideoImportProgress, importErrorMessage } from '@/components/editor/video-link-import';
import { Button } from '@/components/ui/button';
import { userError } from '@/lib/user-error';

type LinkImport = FunctionReturnType<typeof api.library.linkImports>[number];

/** yt-dlp's wording when a site only shows the video to a signed-in viewer. */
const SIGNED_IN_ONLY = /empty media response|--cookies|login required|log in to|logged.in/i;
const failureText = (error?: string) => SIGNED_IN_ONLY.test(error ?? '')
  ? 'This site only shows the video to signed-in viewers, so it cannot be saved from a link. Download it and upload the file instead.'
  : importErrorMessage(error);

/** Video links importing into the Library. The server files each finished one in the Library (`library.settleLinkImport`),
 * so a row simply leaves when its video arrives; a failed one stays until it is dismissed. */
export function LibraryLinkImports({ onUpload }: { onUpload: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const imports = useQuery(api.library.linkImports, isAuthenticated ? {} : 'skip');
  if (!imports?.length) return null;
  return <div className="library-link-imports">{imports.map(item => <LinkImportRow key={item.taskId} item={item} onUpload={onUpload} />)}</div>;
}

function LinkImportRow({ item, onUpload }: { item: LinkImport; onUpload: () => void }) {
  const dismiss = useMutation(api.library.dismissLinkImport);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function remove(upload: boolean) {
    setBusy(true); setError('');
    try { await dismiss({ taskId: item.taskId }); if (upload) onUpload(); }
    catch (reason) { setError(userError(reason, 'Could not remove this import. Please retry.')); setBusy(false); }
  }
  if (item.status === 'failed') return <div className="library-link-failed" role="alert">
    <span className="dash-error">Video import failed. {failureText(item.error)}</span>
    <Button variant="soft" size="sm" disabled={busy} onClick={() => void remove(true)}>Upload the file instead</Button>
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(false)}>Dismiss</Button>
    {error && <span className="dash-error">{error}</span>}
  </div>;
  // While it retries, a signed-in-only refusal reads the same plain way as the final failure.
  const task = { _id: item.taskId, status: item.status, progress: item.progress, attempt: item.attempt, error: item.error && SIGNED_IN_ONLY.test(item.error) ? failureText(item.error) : item.error };
  return <div className="library-link-import"><VideoImportProgress task={task} onUpload={onUpload} /></div>;
}
