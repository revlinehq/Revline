'use client';

import dynamic from 'next/dynamic';
import './editor-demo-preview.css';

const PassiveDemo = dynamic(() => import('./editor-demo').then(module => module.ProductDemo), {
  ssr: false,
  loading: () => <DemoPoster/>,
});

function DemoPoster() {
  return <span className="landing-demo-poster">
    <span className="landing-demo-loading" aria-label="Loading editor preview"/>
  </span>;
}

/** Keep the editor poster visible while the local playback components load. */
export function ProductDemoPreview() {
  return <PassiveDemo/>;
}
