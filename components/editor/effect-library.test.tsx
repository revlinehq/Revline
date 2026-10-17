import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { EffectLibrary } from './effect-library';
import { transitionAvailabilityAt } from '@/lib/editor/transition-placement';
import { EMPTY_TIMELINE } from '@/lib/editor/types';

vi.mock('@/lib/editor/transition-placement', () => ({ transitionAvailabilityAt: vi.fn(() => ({ available: true })) }));

test('only simulates transition placement when the visible library needs transition availability', () => {
  const props = { assets: [], timeline: EMPTY_TIMELINE, onVisualEffect: vi.fn(), onAddTransition: vi.fn() };
  renderToStaticMarkup(<EffectLibrary {...props}/>);
  expect(transitionAvailabilityAt).not.toHaveBeenCalled();
  renderToStaticMarkup(<EffectLibrary {...props} categoryRequest={{ category: 'transitions', requestId: 1 }}/>);
  expect(transitionAvailabilityAt).toHaveBeenCalledTimes(1);
});
