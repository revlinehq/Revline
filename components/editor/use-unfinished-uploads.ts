'use client';

import { useEffect, useState } from 'react';
import { unfinishedUploads, watchUnfinishedUploads, type UnfinishedUpload } from '@/lib/editor/upload-resume';

/** Interrupted uploads to one destination that this browser can continue when the same file is added again. */
export function useUnfinishedUploads(scope?: string): UnfinishedUpload[] {
  const [uploads, setUploads] = useState<{ scope: string; list: UnfinishedUpload[] }>();
  useEffect(() => {
    if (!scope) return;
    let current = true;
    const refresh = () => void unfinishedUploads(scope).then(list => { if (current) setUploads({ scope, list }); });
    refresh();
    const unwatch = watchUnfinishedUploads(refresh);
    return () => { current = false; unwatch(); };
  }, [scope]);
  return uploads && uploads.scope === scope ? uploads.list : none;
}
const none: UnfinishedUpload[] = [];
/** One line that offers to continue; the file itself has to be chosen again by the user. */
export function unfinishedUploadHint(uploads: readonly UnfinishedUpload[], verb: 'Add' | 'Choose' = 'Add') {
  const [first] = uploads;
  if (!first) return undefined;
  return uploads.length > 1 ? `${uploads.length} uploads were interrupted. ${verb} the same files again to continue them.` : `“${first.name}” stopped at ${first.percent}%. ${verb} it again to continue.`;
}
