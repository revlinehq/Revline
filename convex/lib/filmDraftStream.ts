import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { parsePartialJson, type LanguageModelMiddleware } from 'ai';
import type { Clip } from '../../lib/editor/types';
import type { DraftSection } from '../../lib/editor/film-draft';

export type DraftTool = 'addFilm' | 'patchScene';
export const DRAFT_TOOLS: readonly string[] = ['addFilm', 'patchScene'] satisfies DraftTool[];
/** `start` is the timeline second of film time 0; sections are in film seconds. */
export type FilmDraft = { timelineId: string; tool: DraftTool; title: string; start: number; duration: number; clip?: Clip; sections: DraftSection[]; writing?: DraftSection; planned: DraftSection[] };
/** Turns one streaming tool input into the draft to show; `memo` lives as long as that tool call's stream. */
export type BuildFilmDraft = (tool: DraftTool, input: Record<string, unknown>, memo: Record<string, unknown>) => Promise<FilmDraft | undefined>;

/** At most one draft write per second; the code and blocks only change when a section starts or finishes. */
const INTERVAL_MS = 1000;

/**
 * Publishes a film the model is still writing. The runner sees addFilm and patchScene input as it streams; about once
 * a second the partial JSON is parsed, cut to its finished sections and written to the project's draft row when the
 * cut changed. Writes and the final clear go through one queue, so a late write never outlives the clear.
 */
export function filmDraftPublisher({ build, write, clear }: { build: BuildFilmDraft; write: (draft: FilmDraft) => Promise<unknown>; clear: () => Promise<unknown> }) {
  let stream: { id: string; tool: DraftTool; text: string; memo: Record<string, unknown>; closed: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, dirty = false, last = 0, lastKey = '', published = false;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => (queue = queue.then(task).catch(error => console.warn(`[film-draft] ${error instanceof Error ? error.message : String(error)}`)));
  const schedule = () => {
    if (!stream || stream.closed) return;
    if (timer || running) { dirty = true; return; }
    timer = setTimeout(evaluate, Math.max(0, last + INTERVAL_MS - Date.now()));
  };
  const evaluate = async () => {
    timer = undefined;
    const current = stream;
    if (!current || current.closed) return;
    running = true; dirty = false; last = Date.now();
    try {
      const { value } = await parsePartialJson(current.text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const draft = await build(current.tool, value as Record<string, unknown>, current.memo);
      if (!draft || current.closed || stream !== current) return;
      const key = JSON.stringify([draft.timelineId, draft.title, draft.start, draft.duration, draft.clip?.start, draft.clip?.track, draft.clip?.duration, draft.clip?.scene?.code.length, draft.clip?.scene?.code.slice(-200), draft.sections, draft.writing, draft.planned]);
      if (key === lastKey) return;
      lastKey = key; published = true;
      enqueue(() => write(draft));
    } catch (error) {
      console.warn(`[film-draft] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
      if (dirty) schedule();
    }
  };
  const stop = () => { if (stream) stream.closed = true; if (timer) clearTimeout(timer); timer = undefined; };
  return {
    observe(part: LanguageModelV4StreamPart) {
      if (part.type === 'tool-input-start') {
        if (!DRAFT_TOOLS.includes(part.toolName)) return;
        stop();
        stream = { id: part.id, tool: part.toolName as DraftTool, text: '', memo: {}, closed: false };
        lastKey = '';
        return;
      }
      if (!stream || stream.closed) return;
      if (part.type === 'tool-input-delta' && part.id === stream.id) { stream.text += part.delta; schedule(); }
      else if ((part.type === 'tool-input-end' && part.id === stream.id) || (part.type === 'tool-call' && part.toolCallId === stream.id)) stop();
    },
    /** The call landed, failed or the step ended: remove the draft so the saved timeline takes over. */
    landed() {
      stop();
      if (!published) return queue;
      published = false; lastKey = '';
      return enqueue(clear);
    },
  };
}

/** Lets the publisher watch the model's raw stream; parts pass through unchanged. */
export function filmDraftMiddleware(publisher: ReturnType<typeof filmDraftPublisher>): LanguageModelMiddleware {
  return {
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      return { ...result, stream: result.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({ transform(part, controller) { try { publisher.observe(part); } catch { /* A draft never breaks the turn. */ } controller.enqueue(part); } })) };
    },
  };
}
