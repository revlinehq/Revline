'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FilledPlayIcon } from '@/components/workspace/primary-button';
import './editor-demo-preview.css';

const InteractiveDemo = dynamic(() => import('./editor-demo').then(module => module.ProductDemo), {
  ssr: false,
  loading: () => <DemoPoster loading/>,
});

function DemoPoster({ loading = false }: { loading?: boolean }) {
  return <span className="landing-demo-poster">
    <img src="/images/editor-demo-poster.webp" width={1100} height={726} alt="Revline sample edit with footage, captions and timeline" fetchPriority="high"/>
    <span className="landing-demo-poster-action"><FilledPlayIcon/>{loading ? 'Loading editor…' : 'Try the sample editor'}</span>
  </span>;
}

/** A still loads with the hero; editor code and its iframe start on visitor intent. */
export function ProductDemoPreview() {
  const [active, setActive] = useState(false);
  return active ? <InteractiveDemo/> : <button type="button" className="landing-demo-poster-button" aria-label="Try the sample editor" onClick={() => setActive(true)}><DemoPoster/></button>;
}
