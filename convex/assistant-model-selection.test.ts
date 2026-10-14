/// <reference types="vite/client" />
import agentTest from '@convex-dev/agent/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CLAUDE_EDIT_MODELS, type ClaudeModelChoice } from '../lib/ai/claude-model';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const identity = { subject: 'owner', issuer: 'https://fixture.clerk.accounts.dev', tokenIdentifier: 'fixture|owner' };
async function fixture() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const owner = t.withIdentity(identity);
  const projectId = await owner.mutation(api.projects.create, { title: 'Synthetic model selection', aspectRatio: 'vertical' });
  return { t, owner, projectId };
}
beforeEach(() => {
  vi.stubEnv('BILLING_ENABLED', 'false');
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-only');
  vi.stubEnv('AI_GATEWAY_ENABLED', 'false');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-5');
  vi.stubEnv('CLAUDE_GATEWAY_MODEL', 'anthropic/claude-sonnet-5.5');
});
afterEach(() => vi.unstubAllEnvs());

test('disabled manual selection fails before creating a thread, history, messages, or scheduling', async () => {
  const { t, owner, projectId } = await fixture();
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic edit', modelChoice: 'opus' })).rejects.toThrow('disabled');
  expect(await owner.query(api.assistant.status, { projectId })).not.toHaveProperty('modelSwitcher');
  const project = await t.run(ctx => ctx.db.get(projectId));
  expect(project).toMatchObject({ revision: 0, history: [] });
  expect(project?.threadId).toBeUndefined();
  expect(project?.aiRunning).not.toBe(true);
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test.each(CLAUDE_EDIT_MODELS)('$label pins its direct provider/model on a production-enabled switcher', async model => {
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true');
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://different-gnu-398.convex.cloud');
  const { t, owner, projectId } = await fixture();
  expect(await owner.query(api.assistant.status, { projectId })).toMatchObject({ modelSwitcher: true });
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic edit', modelChoice: model.id });
  const scheduled = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].args[0]).toMatchObject({ ownerId: identity.subject, pinnedModel: { provider: 'anthropic', modelId: model.modelId, modelChoice: model.id } });
  vi.stubEnv('CLAUDE_MODEL', 'changed-after-send');
  vi.stubEnv('AI_GATEWAY_ENABLED', 'true');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  expect((await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10)))[0].args[0].pinnedModel).toEqual({ provider: 'anthropic', modelId: model.modelId, modelChoice: model.id });
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Change mid-run', modelChoice: 'haiku' })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(1);
});

test.each(CLAUDE_EDIT_MODELS)('$label preserves the configured gateway provider', async model => {
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true');
  vi.stubEnv('AI_GATEWAY_ENABLED', 'true');
  const { t, owner, projectId } = await fixture();
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic edit', modelChoice: model.id });
  const [scheduled] = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].pinnedModel).toEqual({ provider: 'gateway', modelId: model.gatewayModelId, modelChoice: model.id });
});

test('unselected sends keep env overrides and never expose keys in public status', async () => {
  vi.stubEnv('CLAUDE_MODEL', 'configured-existing-model');
  const { t, owner, projectId } = await fixture();
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic edit' });
  const [scheduled] = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].pinnedModel).toEqual({ provider: 'anthropic', modelId: 'configured-existing-model' });
  const status = await owner.query(api.assistant.status, { projectId });
  expect(JSON.stringify(status)).not.toContain('fixture-only');
  expect(status).not.toHaveProperty('modelId');
});

test('unsupported choices and foreign projects cannot schedule a model request', async () => {
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true');
  const { t, owner, projectId } = await fixture();
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Invalid', modelChoice: 'arbitrary-model' as ClaudeModelChoice })).rejects.toThrow();
  await expect(t.withIdentity({ ...identity, subject: 'stranger' }).mutation(api.assistant.send, { projectId, prompt: 'Foreign', modelChoice: 'haiku' })).rejects.toThrow('Project not found');
  await expect(t.mutation(api.assistant.send, { projectId, prompt: 'Anonymous', modelChoice: 'haiku' })).rejects.toThrow('Authentication required');
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
  expect((await t.run(ctx => ctx.db.get(projectId)))?.threadId).toBeUndefined();
});
