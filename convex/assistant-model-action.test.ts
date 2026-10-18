import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CLAUDE_EDIT_MODELS, OPENAI_EDIT_MODELS, OPENAI_REASONING_EFFORTS, editorProviderOptions, claudeProviderOptions, type ClaudeModelSelection } from '../lib/ai/claude-model';

const fixture = vi.hoisted(() => ({ model: undefined as undefined | { modelId: string; provider: string }, options: undefined as unknown, finishError: undefined as undefined | string, generate: vi.fn(), tokenCounter: vi.fn(() => async () => 10) }));
vi.mock('../lib/ai/anthropic-token-count', () => ({ anthropicTokenCounter: fixture.tokenCounter }));
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
  fixture.model = undefined; fixture.options = undefined; fixture.finishError = undefined; fixture.generate.mockReset(); fixture.tokenCounter.mockClear();
  vi.stubEnv('AI_GATEWAY_ENABLED', 'false');
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-only');
  vi.stubEnv('OPENAI_API_KEY', 'fixture-only');
  vi.stubEnv('CLAUDE_MODEL', 'changed-after-send');
  vi.stubEnv('CLAUDE_GATEWAY_MODEL', 'changed-after-send');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET', 'true');
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

test.each(CLAUDE_EDIT_MODELS)('$label pre-existing direct/gateway pins are refused without generation or timeline edits',async model=>{
  for(const provider of ['anthropic','gateway'] as const){
    await run({provider,modelId:provider==='gateway'?model.gatewayModelId:model.modelId,modelChoice:model.id});
    expect(fixture.generate).not.toHaveBeenCalled();expect(fixture.model).toBeUndefined();expect(fixture.finishError).toContain('supports GPT');
  }
});

test('an inconsistent pinned selection fails without generating or silently falling back', async () => {
  await run({ provider: 'anthropic', modelId: 'claude-haiku-5-5', modelChoice: 'opus' });
  expect(fixture.generate).not.toHaveBeenCalled();
  expect(fixture.model).toBeUndefined();
  expect(fixture.finishError).toContain('supports GPT');
});

// The real SDK model is constructed, while Agent generation stays mocked.
test.each(OPENAI_EDIT_MODELS)('$label action pins native Responses with bounded reasoning instead of a gateway or Claude counter', async model => {
  vi.stubEnv('AI_GATEWAY_ENABLED', 'true');
  await run({ provider: 'openai', modelId: model.modelId, modelChoice: model.id });
  expect(fixture.model).toMatchObject({ modelId: model.modelId, provider: 'openai.responses' });
  expect(fixture.options).toMatchObject({ providerOptions: editorProviderOptions({ provider: 'openai', modelId: model.modelId }) });
  expect(fixture.generate).toHaveBeenCalledOnce();
  expect(fixture.finishError).toBeUndefined();
  expect(fixture.tokenCounter).not.toHaveBeenCalled();
});

test('a removed OpenAI key fails clearly without generating or silently falling back', async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  await run({ provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' });
  expect(fixture.generate).not.toHaveBeenCalled();
  expect(fixture.finishError).toContain('OPENAI_API_KEY');
});

test.each(OPENAI_REASONING_EFFORTS)('queued %s reasoning survives switcher changes and reaches generation', async reasoningEffort => {
  await run({ provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol', reasoningEffort, speedMode: 'fast' });
  expect(fixture.options).toMatchObject({ providerOptions: { openai: { reasoningEffort, serviceTier: 'fast' } } });
  expect(fixture.generate).toHaveBeenCalledOnce();
  expect(fixture.finishError).toBeUndefined();
});
