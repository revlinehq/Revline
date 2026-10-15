'use client';

import { DemoEditor } from '@/components/editor/demo-editor';
import '@/app/editor.css';

/** The landing sample uses the current editor instead of maintaining a second layout. */
export function ProductDemo() {
  return <section className="landing-product-demo" aria-label="Revline sample edit"><DemoEditor embedded/></section>;
}
