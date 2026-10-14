'use client';

import dynamic from 'next/dynamic';

const RecordingEditor = dynamic(() => import('./scripted-demo-editor').then(module => module.ScriptedDemoEditor), {
  ssr: false,
  loading: () => <div className="editor-boot">Opening the recording demo…</div>,
});

export function ScriptedDemoLoader({ demoId }: { demoId: string }) {
  return <RecordingEditor key={demoId} demoId={demoId}/>;
}
