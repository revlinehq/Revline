import { readProject } from './lib/project_data';
/// <reference types="vite/client" />
import agentTest from '@convex-dev/agent/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CLAUDE_EDIT_MODELS, OPENAI_EDIT_MODELS, OPENAI_REASONING_EFFORTS, type ClaudeModelChoice } from '../lib/ai/claude-model';
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
  vi.stubEnv('EDITOR_ALLOW_OPUS', 'true');
  vi.stubEnv('OPENAI_API_KEY', 'fixture-only');
  vi.stubEnv('BILLING_ENABLED', 'false');
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-only');
  vi.stubEnv('AI_GATEWAY_ENABLED', 'false');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false');
  vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-5');
  vi.stubEnv('CLAUDE_GATEWAY_MODEL', 'anthropic/claude-sonnet-5.5');
  vi.stubEnv('EDITOR_DEFAULT_MODEL','');
});
afterEach(() => vi.unstubAllEnvs());

test.each(OPENAI_REASONING_EFFORTS)('manual OpenAI %s reasoning is pinned with the queued model', async reasoningEffort => {
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_DEFAULT_MODEL', 'gpt-6.1-sol');
  const { t, owner, projectId } = await fixture();
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic effort edit', reasoningEffort });
  const [scheduled] = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].pinnedModel).toEqual({ provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol', reasoningEffort });
});

test.each(OPENAI_EDIT_MODELS)('$label pins Fast mode independently from reasoning', async model => {
  vi.stubEnv('MODEL_SWITCHER_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'fixture-only');
  const { t, owner, projectId } = await fixture();
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Synthetic fast edit', modelChoice: model.id, speedMode: 'fast', reasoningEffort: 'high' });
  const [scheduled] = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].pinnedModel).toEqual({ provider: 'openai', modelId: model.modelId, modelChoice: model.id, reasoningEffort: 'high', speedMode: 'fast' });
});

test.each(['disabled', 'claude', 'unsupported'])('rejects %s speed overrides before scheduling', async mode => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_DEFAULT_MODEL', mode === 'claude' ? 'sonnet' : 'gpt-6.1-sol');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', mode === 'disabled' ? 'false' : 'true');
  const { t, owner, projectId } = await fixture();
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Invalid speed', speedMode: (mode === 'unsupported' ? 'ultrafast' : 'fast') as 'fast' })).rejects.toThrow();
  expect((await t.run(ctx => readProject(ctx, projectId)))?.threadId).toBeUndefined();
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test.each(['disabled', 'claude', 'unsupported'])('rejects %s reasoning overrides before creating a conversation or scheduling paid work', async mode => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_DEFAULT_MODEL', mode === 'claude' ? 'sonnet' : 'gpt-6.1-sol');
  vi.stubEnv('MODEL_SWITCHER_ENABLED', mode === 'disabled' ? 'false' : 'true');
  const { t, owner, projectId } = await fixture();
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Invalid effort', reasoningEffort: (mode === 'unsupported' ? 'none' : 'high') as 'high' })).rejects.toThrow();
  expect((await t.run(ctx => readProject(ctx, projectId)))?.threadId).toBeUndefined();
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test.each(CLAUDE_EDIT_MODELS)('$label stale requests fail before creating messages or scheduling paid work',async model=>{
  vi.stubEnv('MODEL_SWITCHER_ENABLED','true');vi.stubEnv('AI_GATEWAY_ENABLED','true');vi.stubEnv('EDITOR_ALLOW_OPUS','true');
  const {t,owner,projectId}=await fixture();
  expect(await owner.query(api.assistant.status,{projectId})).toMatchObject({configured:true,defaultModelChoice:'gpt-6.1-sol',allowedModels:['gpt-6.1-sol','gpt-6-astra']});
  await expect(owner.mutation(api.assistant.send,{projectId,prompt:'Stale request',modelChoice:model.id})).rejects.toThrow('supports GPT');
  expect((await t.run(ctx=>readProject(ctx,projectId)))?.threadId).toBeUndefined();expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test('disabled manual selection and invalid credentials cannot create a conversation',async()=>{
  const {t,owner,projectId}=await fixture();
  await expect(owner.mutation(api.assistant.send,{projectId,prompt:'Synthetic edit',modelChoice:'gpt-6-astra'})).rejects.toThrow('disabled');
  vi.stubEnv('OPENAI_API_KEY','');
  await expect(owner.mutation(api.assistant.send,{projectId,prompt:'Synthetic edit'})).rejects.toThrow('OPENAI_API_KEY');
  expect((await owner.query(api.assistant.status,{projectId})).configured).toBe(false);
  expect((await t.run(ctx=>readProject(ctx,projectId)))?.threadId).toBeUndefined();expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test.each(OPENAI_EDIT_MODELS)('$label pins native OpenAI despite gateway flags and later defaults',async model=>{
  vi.stubEnv('MODEL_SWITCHER_ENABLED','true');vi.stubEnv('AI_GATEWAY_ENABLED','true');
  const {t,owner,projectId}=await fixture();
  await owner.mutation(api.assistant.send,{projectId,prompt:'Synthetic edit',modelChoice:model.id});
  const [scheduled]=await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].pinnedModel).toEqual({provider:'openai',modelId:model.modelId,modelChoice:model.id});
  vi.stubEnv('MODEL_SWITCHER_ENABLED','false');vi.stubEnv('EDITOR_DEFAULT_MODEL','gpt-6-astra');
  expect((await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10)))[0].args[0].pinnedModel).toEqual(scheduled.args[0].pinnedModel);
});

test('unset default is Sol, while invalid legacy defaults fail without falling back',async()=>{
  const {t,owner,projectId}=await fixture();
  expect(await owner.query(api.assistant.status,{projectId})).toMatchObject({configured:true,defaultModelChoice:'gpt-6.1-sol'});
  vi.stubEnv('EDITOR_DEFAULT_MODEL','sonnet');
  expect((await owner.query(api.assistant.status,{projectId})).configured).toBe(false);
  await expect(owner.mutation(api.assistant.send,{projectId,prompt:'Synthetic edit'})).rejects.toThrow('supports GPT');
  expect((await t.run(ctx=>readProject(ctx,projectId)))?.threadId).toBeUndefined();
  vi.stubEnv('EDITOR_DEFAULT_MODEL','');await owner.mutation(api.assistant.send,{projectId,prompt:'Synthetic edit'});
  const [scheduled]=await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10));expect(scheduled.args[0].pinnedModel).toEqual({provider:'openai',modelId:'gpt-6.1-sol',modelChoice:'gpt-6.1-sol'});
  expect(JSON.stringify(await owner.query(api.assistant.status,{projectId}))).not.toContain('fixture-only');
});

test('unsupported choices, foreign projects and anonymous calls cannot schedule requests',async()=>{
  vi.stubEnv('MODEL_SWITCHER_ENABLED','true');const {t,owner,projectId}=await fixture();
  await expect(owner.mutation(api.assistant.send,{projectId,prompt:'Invalid',modelChoice:'arbitrary-model' as ClaudeModelChoice})).rejects.toThrow();
  await expect(t.withIdentity({...identity,subject:'stranger'}).mutation(api.assistant.send,{projectId,prompt:'Foreign',modelChoice:'gpt-6.1-sol'})).rejects.toThrow('Project not found');
  await expect(t.mutation(api.assistant.send,{projectId,prompt:'Anonymous',modelChoice:'gpt-6.1-sol'})).rejects.toThrow('Authentication required');
  expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});

test('new composer media references are owned project IDs pinned with the exact request', async () => {
  const { t, owner, projectId } = await fixture();
  const own = await t.run(ctx => ctx.db.insert('assets', { ownerId: identity.subject, projectId, fileName: 'fixture.mp4', kind: 'video', contentType: 'video/mp4', size: 1, createdAt: 1 }));
  await owner.mutation(api.assistant.send, { projectId, prompt: 'Use this new video.', attachedAssetIds: [own] });
  const [scheduled] = await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10));
  expect(scheduled.args[0].attachedAssetIds).toEqual([own]);
});
test('foreign, cross-project and duplicate attachments cannot create chat messages or schedule work', async () => {
  const { t, owner, projectId } = await fixture();
  const otherProject = await owner.mutation(api.projects.create, { title: 'Other', aspectRatio: 'vertical' });
  const make = (ownerId: string, project: typeof projectId) => t.run(ctx => ctx.db.insert('assets', { ownerId, projectId: project, fileName: 'fixture.mp4', kind: 'video', contentType: 'video/mp4', size: 1, createdAt: 1 }));
  const foreign = await make('stranger', projectId), other = await make(identity.subject, otherProject), own = await make(identity.subject, projectId);
  for(const ids of [[foreign],[other],[own,own],Array(21).fill(own)]) await expect(owner.mutation(api.assistant.send, { projectId, prompt: 'Use this.', attachedAssetIds: ids })).rejects.toThrow(/media|unique/);
  expect((await t.run(ctx=>readProject(ctx,projectId)))?.threadId).toBeUndefined();
  expect(await t.run(ctx=>ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(0);
});
