import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CLAUDE_EDIT_MODELS, claudeProviderOptions, type ClaudeModelSelection } from '../lib/ai/claude-model';

const fixture = vi.hoisted(() => ({ model: undefined as undefined | { modelId: string; provider: string }, options: undefined as unknown, finishError: undefined as undefined | string, generate: vi.fn() }));
vi.mock('@convex-dev/agent', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  Agent: class {
    constructor(_component: unknown, options: { languageModel: { modelId: string; provider: string } }) { fixture.model = options.languageModel; }
    async streamText(_ctx: unknown, _identity: unknown, options: unknown) {
      fixture.options = options;
      fixture.generate();
      return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) };
    }
  },
  createTool: (options: unknown) => options,
  saveMessage: async () => null,
}));
import { respond } from './assistantActions';

beforeEach(() => {
  fixture.model = undefined; fixture.options = undefined; fixture.finishError = undefined; fixture.generate.mockReset();
  vi.stubEnv('AI_GATEWAY_ENABLED', 'false');
  vi.stubEnv('CLAUDE_MODEL', 'changed-after-send');
  vi.stubEnv('CLAUDE_GATEWAY_MODEL', 'changed-after-send');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
});
afterEach(() => vi.unstubAllEnvs());

async function run(pinnedModel: ClaudeModelSelection) {
  const ctx = {
    runQuery: async (reference: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(reference)) {
        case 'assistant:currentPrompt': return 'Synthetic editing request';
        case 'assistant:getRun': return { project: { timeline: { clips: [], fps: 30, aspectRatio: 'vertical' }, revision: 0, aspectRatio: 'vertical' }, assets: [] };
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected fixture query');
      }
    },
    runMutation: async (_reference: unknown, args: { error?: string }) => { fixture.finishError = args.error; return null; },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel });
}

test.each(CLAUDE_EDIT_MODELS)('$label action uses the captured direct model after env changes and uses supported thinking options', async model => {
  await run({ provider: 'anthropic', modelId: model.modelId, modelChoice: model.id });
  expect(fixture.model?.modelId).toBe(model.modelId);
  expect(fixture.model?.provider).toContain('anthropic');
  expect(fixture.options).toMatchObject({ providerOptions: claudeProviderOptions(model.modelId) });
  expect(fixture.generate).toHaveBeenCalledOnce();
  expect(fixture.finishError).toBeUndefined();
});

test.each(CLAUDE_EDIT_MODELS)('$label action keeps the gateway pinned even when its environment flag changes', async model => {
  await run({ provider: 'gateway', modelId: model.gatewayModelId, modelChoice: model.id });
  expect(fixture.model?.modelId).toBe(model.gatewayModelId);
  expect(fixture.options).toMatchObject({ providerOptions: claudeProviderOptions(model.gatewayModelId) });
  expect(fixture.generate).toHaveBeenCalledOnce();
  expect(fixture.finishError).toBeUndefined();
});

test('an inconsistent pinned selection fails without generating or silently falling back', async () => {
  await run({ provider: 'anthropic', modelId: 'claude-haiku-5-5', modelChoice: 'opus' });
  expect(fixture.generate).not.toHaveBeenCalled();
  expect(fixture.model).toBeUndefined();
  expect(fixture.finishError).toContain('model configuration');
});
