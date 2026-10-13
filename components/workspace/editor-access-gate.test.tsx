import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';
import { EditorAccessGate } from './editor-access-gate';

const fixture = vi.hoisted(() => ({ status: undefined as undefined | { enabled: boolean; configured: boolean; subscribed: boolean; trialEligible: boolean; needsPayment: boolean } }));
vi.mock('convex/react', () => ({ useConvexAuth: () => ({ isAuthenticated: true }), useQuery: () => fixture.status, useAction: () => vi.fn() }));
vi.mock('./workspace-nav', () => ({ WorkspaceNav: () => <nav>Revline</nav> }));
beforeEach(() => { fixture.status = { enabled: true, configured: true, subscribed: false, trialEligible: true, needsPayment: false }; });

test('a new user sees the trial and cannot mount the upload/editor workflow', () => {
  const child = vi.fn(() => <div>Editing workflow</div>);
  const Child = child;
  const html = renderToStaticMarkup(<EditorAccessGate><Child /></EditorAccessGate>);
  expect(html).toContain('Try Revline free for 3 days');
  expect(html).toContain('Start free trial');
  expect(html).toContain('$39');
  expect(child).not.toHaveBeenCalled();
});
test.each(['subscribed', 'local'])('%s access mounts the editor', mode => {
  fixture.status!.subscribed = mode === 'subscribed';
  fixture.status!.enabled = mode !== 'local';
  expect(renderToStaticMarkup(<EditorAccessGate><div>Editing workflow</div></EditorAccessGate>)).toContain('Editing workflow');
});
test('payment failure directs users to their existing billing account', () => {
  Object.assign(fixture.status!, { needsPayment: true, trialEligible: false });
  const html = renderToStaticMarkup(<EditorAccessGate><div>Editing workflow</div></EditorAccessGate>);
  expect(html).toContain('Update payment method');
  expect(html).not.toContain('Start free trial');
});
test('loading and missing configuration do not mount the editor', () => {
  fixture.status = undefined;
  expect(renderToStaticMarkup(<EditorAccessGate><div>Editing workflow</div></EditorAccessGate>)).toContain('Checking your plan');
  fixture.status = { enabled: true, configured: false, subscribed: false, trialEligible: true, needsPayment: false };
  const html = renderToStaticMarkup(<EditorAccessGate><div>Editing workflow</div></EditorAccessGate>);
  expect(html).toContain('Billing is temporarily unavailable');
  expect(html).toContain('disabled');
  expect(html).not.toContain('Editing workflow');
});
