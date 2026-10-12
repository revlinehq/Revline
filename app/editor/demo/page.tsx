import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DemoEditor } from '@/components/editor/demo-editor';
import '@/app/editor.css';
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ export?: string | string[] }> }) {
  if ((await searchParams).export === '1') redirect('/sign-in');
  return <Suspense fallback={<div className="editor-boot">Opening the sample editor…</div>}><DemoEditor /></Suspense>;
}
