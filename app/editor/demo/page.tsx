import { Suspense } from 'react';
import { DemoEditor } from '@/components/editor/demo-editor';
import '@/app/editor.css';
export default function DemoPage() { return <Suspense fallback={<div className="editor-boot">Opening the sample editor…</div>}><DemoEditor /></Suspense>; }
