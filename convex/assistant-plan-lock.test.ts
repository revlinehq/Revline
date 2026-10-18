import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ generate: undefined as undefined | ((tools: Record<string, { execute: (ctx: unknown, input: unknown) => Promise<unknown> }>) => Promise<void>), events: [] as string[] }));
vi.mock('@convex-dev/agent', async original => ({ ...await original<Record<string, unknown>>(), createTool: (options: unknown) => options, saveMessage: async () => null,
  Agent: class {
    constructor(_component: unknown, private options: { tools: Parameters<NonNullable<typeof fixture.generate>>[0] }) {}
    async streamText() { await fixture.generate!(this.options.tools); return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) }; }
  },
}));
import { respond } from './assistantActions';
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET', 'false'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false'); vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false'); fixture.events = []; });
afterEach(() => vi.unstubAllEnvs());
async function run() {
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:currentPrompt': return 'Round the footage corners.';
        case 'assistant:getRun': return { project: { timeline: { fps: 30, aspectRatio: 'landscape', clips: [] }, revision: 67 }, assets: [] };
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected fixture query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0]) => { fixture.events.push(getFunctionName(ref)); return null; },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
}
const plan = { id: 'round', kind: 'visual', effect: 'frameCorners', purpose: 'Round the footage corners', strength: '6% corner radius', expectation: 'Rounded corners expose the background', start: 0, duration: 1, anchor: { kind: 'requested-time', time: 0, description: 'Requested edit' } };
test('explicit creative planning acquires the workflow lock before validation and retains it across correction', async () => {
  fixture.generate = async tools => {
    await expect(tools.planEffects.execute({}, { plans: [{ ...plan, targetClipId: 'missing' }] })).rejects.toThrow('target');
    expect(fixture.events).toContain('assistant:beginEditing');
    expect(fixture.events).not.toContain('compositionReview:savePlan');
    await tools.planEffects.execute({}, { plans: [plan] });
    expect(fixture.events.indexOf('assistant:beginEditing')).toBeLessThan(fixture.events.indexOf('compositionReview:savePlan'));
  };
  await run();
  expect(fixture.events.filter(event => event === 'assistant:beginEditing')).toHaveLength(1);
});
test('a plain answer or read-only timeline question does not acquire an editing lock', async () => {
  fixture.generate = async tools => { await tools.inspectTimeline.execute({}, {}); };
  await run();
  expect(fixture.events).not.toContain('assistant:beginEditing');
});
