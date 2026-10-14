'use client';

import dynamic from 'next/dynamic';
import './editor-demo-preview.css';

const InteractiveDemo = dynamic(() => import('./editor-demo').then(module => module.ProductDemo), {
  ssr: false,
  loading: () => <DemoPoster/>,
});

function DemoPoster() {
  return <span className="landing-demo-poster">
    <img src="/images/editor-demo-poster.webp" width={1100} height={726} alt="Revline sample edit with footage, captions and timeline" fetchPriority="high"/>
  </span>;
}

/** Keep the still visible while the interactive editor loads. */
export function ProductDemoPreview() {
  return <InteractiveDemo/>;
}
