'use client';

import dynamic from 'next/dynamic';
import { EditorSkeleton } from './editor-skeleton';

// The editor is the heaviest code in the app. It loads as its own chunk behind the frame below, so opening a
// project paints at once, and pages that lead to a project can fetch it ahead of the click with preloadEditor().
// The import() is written inside the dynamic() call, which is how Next matches the chunk and preloads it on a full page load.
const Editor = dynamic(() => import('./connected-editor').then(module => module.ConnectedEditor), { loading: () => <EditorSkeleton /> });

/** Fetches the editor's code once the browser is idle. Call from an effect on a page whose next step is opening a project. */
export function preloadEditor() {
  const load = () => void import('./connected-editor').catch(() => { /* Opening a project loads it again. */ });
  if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(load, { timeout: 4000 }); return () => cancelIdleCallback(id); }
  const timer = setTimeout(load, 1500);
  return () => clearTimeout(timer);
}

/** A project's editor. */
export function EditorRoute({ projectId }: { projectId: string }) {
  return <Editor key={projectId} projectId={projectId} />;
}
