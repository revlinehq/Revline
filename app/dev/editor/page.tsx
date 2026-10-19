import { notFound } from 'next/navigation';
import { DemoEditor } from '@/components/editor/demo-editor';
import '@/app/editor.css';

export default function EditorFixturePage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DemoEditor />;
}
