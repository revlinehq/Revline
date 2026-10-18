import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { DevOpenAiCosts } from './dev-openai-costs';
test('official source renders a separate heading and no credential value in initial markup', () => {
  const html = renderToStaticMarkup(<DevOpenAiCosts days={7} />);
  expect(html).toContain('OpenAI-reported project cost');
  expect(html).toContain('Official project totals, separate from edit estimates.');
  expect(html).not.toContain('sk-admin-');
  expect(html).not.toContain('localStorage');
});
