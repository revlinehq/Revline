'use client';

import dynamic from 'next/dynamic';
import './editor-demo-preview.css';

const PassiveDemo = dynamic(() => import('./editor-demo').then(module => module.ProductDemo), {
  ssr: false,
  loading: () => <DemoPoster/>,
});

function DemoPoster() {
  return <span className="landing-demo-poster">
    <img src="/images/editor-demo-poster.webp" width={1240} height={742} alt="Revline editor with its current conversation, preview and timeline" fetchPriority="high"/>
  </span>;
}

/** Keep the editor poster visible while the local playback components load. */
export function ProductDemoPreview() {
  return <PassiveDemo/>;
}
