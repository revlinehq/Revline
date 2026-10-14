import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ScriptedDemoLoader } from '@/components/editor/scripted-demo-loader';
import '@/app/editor.css';

export const metadata: Metadata = { title: 'Recording demo — Revline', robots: { index: false, follow: false } };
export default async function RecordingDemoPage({ params }: { params: Promise<{ demoId: string }> }) {
  const { demoId } = await params;
  return <Suspense fallback={<div className="editor-boot">Opening the recording demo…</div>}><ScriptedDemoLoader demoId={demoId}/></Suspense>;
}
