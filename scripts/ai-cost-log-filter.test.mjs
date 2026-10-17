import { expect, test } from 'vitest';
import { aiCostLines } from './ai-cost-log-filter.mjs';

test('the dev tail forwards cost records only and drops unrelated, malformed and truncated logs', () => {
  const event = { event: 'model-step', projectId: 'project', runId: 'run', stepEstimatedUsd: .01 };
  expect(aiCostLines(JSON.stringify({ logLines: [{ messages: [`[ai-cost] ${JSON.stringify(event)}`], isTruncated: false }, { messages: ['private backend data'] }, { messages: ['bad [ai-cost] data'] }, { messages: ['[ai-cost] not json'] }, { messages: [`[ai-cost] ${JSON.stringify(event)}`], isTruncated: true }] }))).toEqual([`[ai-cost] ${JSON.stringify(event)}`]);
  expect(aiCostLines('authentication failed')).toEqual([]);
  expect(aiCostLines(JSON.stringify({ kind: 'Progress', udfType: 'Action', logLines: [{ messages: [`'[ai-cost] ${JSON.stringify(event)}'`], isTruncated: false }] }))).toEqual([`[ai-cost] ${JSON.stringify(event)}`]);
  expect(aiCostLines(JSON.stringify({ logLines: [{ messages: ["'private backend data'"] }, { messages: [`'[ai-cost] ${JSON.stringify(event)}`] }] }))).toEqual([]);
  expect(aiCostLines(JSON.stringify({ logLines: [{ messages: ['[ai-cost] {"event":"unknown"}'] }] }))).toEqual([]);
});
