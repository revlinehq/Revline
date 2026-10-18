import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { DevOpenAiCosts } from './dev-openai-costs';
test('official source renders one heading and no credential value in initial markup', () => {
  const html = renderToStaticMarkup(<DevOpenAiCosts days={7} />);
  expect(html).toContain('OpenAI costs');
  expect(html).toContain('Reported spend for your Revline API project.');
  expect(html).not.toContain('sk-admin-');
  expect(html).not.toContain('localStorage');
});
