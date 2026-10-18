import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Timeline } from '../lib/editor/types';
const fixture = vi.hoisted(() => ({ generate: undefined as undefined | ((tools: Record<string, { inputSchema: { parse: (input: unknown) => unknown }; execute: (ctx: unknown, input: unknown) => Promise<unknown> }>) => Promise<unknown>) }));
vi.mock('@convex-dev/agent', async original => ({ ...await original<Record<string, unknown>>(), createTool: (options: unknown) => options, saveMessage: async () => null,
  Agent: class {
    constructor(_component: unknown, private options: { tools: Parameters<NonNullable<typeof fixture.generate>>[0] }) {}
    async streamText() { await fixture.generate!(this.options.tools); return { finishReason: Promise.resolve('stop'), steps: Promise.resolve([]) }; }
  },
}));
import { respond } from './assistantActions';
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'fixture-only'); vi.stubEnv('EDITOR_ENFORCE_TOKEN_BUDGET', 'false'); vi.stubEnv('MODEL_SWITCHER_ENABLED', 'false'); vi.stubEnv('AI_COST_DASHBOARD_ENABLED', 'false'); });
afterEach(() => vi.unstubAllEnvs());

test('the actual existing batch tool restyles four graphic titles and requested casing in one saved operation', async () => {
  let timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 4 }, (_, index) => ({ id: `title-${index}`, kind: 'graphic', text: `${index + 1}) UPLOAD YOUR FOOTAGE`, start: index * 3, duration: 3, sourceStart: 0, background: '#000000', animation: 'rise' })) };
  const original = structuredClone(timeline); let revision = 27, writes = 0, finishError: string | undefined;
  fixture.generate = async tools => {
    const tool = tools.styleCaptions;
    const input = tool.inputSchema.parse({ clipIds: timeline.clips.map(clip => clip.id), fontFamily: 'poppins', background: 'transparent', textStyle: { strokeWidth: 3, strokeColor: '#000000', glowBlur: 0, shadowBlur: 0 }, textCase: 'sentence' });
    expect(await tool.execute({}, input)).toMatchObject({ saved: true, staged: false, revision: 28 });
  };
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:getRun': return { project: { timeline, revision, aspectRatio: timeline.aspectRatio }, assets: [] };
        case 'assistant:currentPrompt': return 'Restyle these exact four labels and use sentence case.';
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: { timeline: Timeline; error?: string }) => {
      switch (getFunctionName(ref)) {
        case 'assistant:beginEditing': return null;
        case 'assistant:apply': writes++; timeline = args.timeline; return ++revision;
        case 'assistant:finish': finishError = args.error; return null;
        default: throw new Error('No plan, media analysis or rendered review is needed for plain styling');
      }
    },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
  expect(finishError).toBeUndefined(); expect(writes).toBe(1); expect(revision).toBe(28);
  expect(timeline.clips.every(clip => clip.background === 'transparent' && clip.fontFamily === 'poppins' && clip.text?.endsWith('Upload your footage'))).toBe(true);
  expect(timeline.clips.map(({ start, duration, animation }) => ({ start, duration, animation }))).toEqual(original.clips.map(({ start, duration, animation }) => ({ start, duration, animation })));
});

test('five identical visual transforms save as one atomic batch and preserve linked audio and timing', async () => {
  let timeline: Timeline = { fps: 30, aspectRatio: 'landscape', clips: Array.from({ length: 5 }, (_, index) => [
    { id: `video-${index}`, kind: 'video' as const, linkedClipId: `audio-${index}`, start: index * 3, duration: 3, sourceStart: index * 8, playbackRate: 2 },
    { id: `audio-${index}`, kind: 'audio' as const, linkedClipId: `video-${index}`, start: index * 3, duration: 3, sourceStart: index * 8, playbackRate: 2 },
  ]).flat() };
  const original = structuredClone(timeline); let revision = 35, writes = 0, finishError: string | undefined;
  fixture.generate = async tools => {
    const tool = tools.transformClip;
    expect(() => tool.inputSchema.parse({ clipId: 'video-0', clipIds: ['video-1'], scale: .84 })).toThrow();
    expect(() => tool.inputSchema.parse({ clipIds: ['video-0', 'video-0'], scale: .84 })).toThrow();
    const batch = tool.inputSchema.parse({ clipIds: original.clips.filter(clip => clip.kind === 'video').map(clip => clip.id), scale: .84, x: .5, y: .57 });
    expect(await tool.execute({}, batch)).toMatchObject({ saved: true, staged: false, revision: 36 });
    const afterBatch = structuredClone(timeline);
    await expect(tool.execute({}, tool.inputSchema.parse({ clipIds: ['video-0', 'audio-0'], scale: .5 }))).rejects.toThrow('video or image');
    expect(timeline).toEqual(afterBatch); expect(writes).toBe(1);
    expect(await tool.execute({}, tool.inputSchema.parse({ clipId: 'video-0', opacity: .8 }))).toMatchObject({ saved: true, revision: 37 });
  };
  const ctx = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      switch (getFunctionName(ref)) {
        case 'assistant:getRun': return { project: { timeline, revision, aspectRatio: timeline.aspectRatio }, assets: [] };
        case 'assistant:currentPrompt': return 'Use the same smaller framing for all five video clips.';
        case 'assistant:isRunActive': return true;
        default: throw new Error('Unexpected query');
      }
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: { timeline: Timeline; error?: string }) => {
      switch (getFunctionName(ref)) {
        case 'assistant:beginEditing': return null;
        case 'assistant:apply': writes++; timeline = args.timeline; return ++revision;
        case 'assistant:finish': finishError = args.error; return null;
        default: throw new Error('Unexpected mutation');
      }
    },
  };
  await (respond as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, { projectId: 'project', ownerId: 'owner', runId: 'run', threadId: 'thread', promptMessageId: 'prompt', pinnedModel: { provider: 'openai', modelId: 'gpt-6.1-sol', modelChoice: 'gpt-6.1-sol' } });
  expect(finishError).toBeUndefined(); expect(writes).toBe(2);
  expect(timeline.clips.filter(clip => clip.kind === 'video').every(clip => clip.transform?.scale === .84 && clip.transform.y === .57)).toBe(true);
  expect(timeline.clips.filter(clip => clip.kind === 'audio')).toEqual(original.clips.filter(clip => clip.kind === 'audio'));
  expect(timeline.clips.map(({ start, duration, sourceStart, playbackRate }) => ({ start, duration, sourceStart, playbackRate }))).toEqual(original.clips.map(({ start, duration, sourceStart, playbackRate }) => ({ start, duration, sourceStart, playbackRate })));
});
