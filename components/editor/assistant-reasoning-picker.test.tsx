import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,test,vi} from 'vitest';
import {AssistantPanel} from './assistant-panel';
import type {ClaudeModelChoice} from '@/lib/ai/claude-model';

afterEach(()=>vi.unstubAllEnvs());
function render(defaultModelChoice:ClaudeModelChoice,running=false,modelSwitcher=true){return renderToStaticMarkup(<AssistantPanel messages={[]} running={running} configured hasClips demo={false} modelSwitcher={modelSwitcher} defaultModelChoice={defaultModelChoice} allowedModels={['sonnet','gpt-6.1-sol','gpt-6-astra']} onSend={async()=>{}}/>);}

test('reasoning starts at Medium for both OpenAI models only behind the development model gate',()=>{
  vi.stubEnv('NODE_ENV','development');
  for(const model of ['gpt-6.1-sol','gpt-6-astra'] as const){const html=render(model);expect(html).toContain('aria-label="AI reasoning effort"');expect(html).toContain('Medium');expect(html).toContain('aria-label="AI speed mode"');expect(html).toContain('Standard');}
  const stale=render('sonnet');expect(stale).toContain('GPT-6.1 Sol');expect(stale).not.toContain('Sonnet');
  expect(render('gpt-6.1-sol',false,false)).not.toContain('AI reasoning effort');
  vi.stubEnv('NODE_ENV','production');
  const html=render('gpt-6.1-sol');expect(html).not.toContain('AI reasoning effort');expect(html).not.toContain('AI editing model');expect(html).not.toContain('AI speed mode');
});

test('the reasoning control is disabled with the selected model while a request is running',()=>{
  vi.stubEnv('NODE_ENV','development');
  const html=render('gpt-6.1-sol',true);
  const control=html.match(/<button[^>]*aria-label="AI reasoning effort"[^>]*>/)?.[0];
  expect(control).toBeDefined();expect(control).toContain('disabled');
  expect(html.match(/<button[^>]*aria-label="AI speed mode"[^>]*>/)?.[0]).toContain('disabled');
});
