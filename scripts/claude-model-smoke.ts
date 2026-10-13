import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { CLAUDE_MODEL, claudeProviderOptions } from '../lib/ai/claude-model';

async function main() {
  const apiKey = execFileSync(process.execPath, ['node_modules/convex/bin/main.js', 'env', 'get', 'ANTHROPIC_API_KEY', '--deployment', 'majestic-alpaca-541'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert(apiKey.startsWith('sk-ant-'), 'The development API credential is unavailable.');
  const model = createAnthropic({ apiKey })(CLAUDE_MODEL);
  let calls = 0;
  const tools = { inspectTestTimeline: tool({ description: 'Read the synthetic test timeline. No user data or edits.', inputSchema: z.object({}), execute: async () => { calls++; return { clipCount: 3 }; } }) };
  const settings = { model, providerOptions: claudeProviderOptions(CLAUDE_MODEL), tools, stopWhen: stepCountIs(3), maxOutputTokens: 1024 };
  const first = await generateText({ ...settings, system: 'Read the test timeline with the tool and report its clip count in one sentence. Editing context version 1.', prompt: 'How many clips are in the test timeline?' });
  assert(calls > 0, 'The model did not inspect the test timeline.');
  assert(first.text.includes('3'), 'The answer did not report the tool result.');
  const second = await generateText({ ...settings, system: 'Read the test timeline with the tool and report its clip count in one sentence. Editing context version 2.', messages: [{ role: 'user', content: 'How many clips are in the test timeline?' }, ...first.response.messages, { role: 'user', content: 'Check the count again.' }] });
  assert(second.text.includes('3'), 'The follow-up did not report the tool result.');
  console.log(JSON.stringify({ model: CLAUDE_MODEL, toolCalls: calls, firstFinishReason: first.finishReason, secondFinishReason: second.finishReason, changedContextFollowup: 'passed' }));
}
main().catch((error: unknown) => {
  const e = error as { statusCode?: number; name?: string };
  console.error(JSON.stringify({ test: 'claude-model-smoke', status: 'failed', errorType: e?.name ?? 'Error', statusCode: e?.statusCode }));
  process.exitCode = 1;
});
