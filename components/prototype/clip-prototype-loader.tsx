'use client';
import dynamic from 'next/dynamic';
const ClipPrototype = dynamic(() => import('./clip-prototype').then(module => module.ClipPrototype), { ssr: false, loading: () => <div className="editor-boot">Opening your editor…</div> });
export function ClipPrototypeLoader() { return <ClipPrototype/>; }
