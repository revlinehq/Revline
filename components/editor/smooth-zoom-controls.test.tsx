import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { SmoothZoomControls } from './smooth-zoom-controls';
import type { Clip, MediaAsset } from '@/lib/editor/types';

const clip: Clip = { id: 'clip', kind: 'image', assetId: 'source', start: 0, duration: 4, sourceStart: 0 };
const asset: MediaAsset = { _id: 'source', kind: 'image', fileName: 'source.svg', url: '/source.svg', width: 1920, height: 1080 };
afterEach(() => vi.unstubAllEnvs());

it('keeps manual zoom controls entirely out of the production inspector', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(renderToStaticMarkup(<SmoothZoomControls clip={clip} asset={asset} aspectRatio="landscape" fps={30} onChange={() => {}} />)).toBe('');
});

it('provides entry, hold, exit, normalized original-source focus and easing in development', () => {
  vi.stubEnv('NODE_ENV', 'development');
  const html = renderToStaticMarkup(<SmoothZoomControls clip={clip} asset={asset} aspectRatio="landscape" fps={30} onChange={() => {}} />);
  for (const label of ['Zoom start', 'Zoom in', 'Hold', 'Zoom out', 'Source focus X', 'Source focus Y', 'Zoom easing', 'Apply zoom']) expect(html).toContain(label);
  expect(html).toContain('Set Zoom out to 0 to stay zoomed in');
});
