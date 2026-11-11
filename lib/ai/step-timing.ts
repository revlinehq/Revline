/** Where a run's time went: one entry per model call and per tool call. Names, times and token counts only; never
 *  prompts, tool arguments or results. `key` is a short hash of a tool call's arguments, so a repeated identical call
 *  can be counted without storing what was asked. */
export type StepTiming = {
  step: number;
  kind: 'model' | 'tool';
  /** Tool name; absent for a model call. */
  name?: string;
  /** When it started, epoch ms. */
  at: number;
  ms: number;
  /** Model call: time to the first output chunk. */
  firstOutputMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  failed?: boolean;
  key?: string;
};

/** Tools that draw frames or decode media on the media worker: the expensive kind of look. */
export const RENDERING_TOOLS = new Set(['getFrames', 'readFrames', 'inspectFrames', 'inspectVideo', 'checkSpots', 'checkPacing', 'checkSound', 'getSound', 'checkClip', 'previewRender', 'finish', 'readScript', 'detectFacecam', 'followSubject', 'normalizeAudio', 'exportVideo']);

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/** FNV-1a over the JSON of the arguments: enough to tell "the same call again" apart, and not reversible. */
export function argumentKey(input: unknown) {
  let text: string;
  try { text = JSON.stringify(input) ?? ''; } catch { text = ''; }
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type Usage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } };

/** Collects a turn's timings in memory; `drain` hands over what is new, to be saved with the step's checkpoint. */
export class StepTimer {
  private entries: StepTiming[] = [];
  private modelStarted = new Map<string, number>();
  private toolStarted = new Map<string, { at: number; name: string; key: string }>();
  constructor(private now: () => number = Date.now) {}

  modelStart(id: string) { this.modelStarted.set(id, this.now()); }

  modelEnd(id: string, step: number, event: { usage?: Usage; performance?: { responseTimeMs?: number; timeToFirstOutputMs?: number } }) {
    const ended = this.now(), ms = count(event.performance?.responseTimeMs) ?? Math.max(0, ended - (this.modelStarted.get(id) ?? ended));
    const at = this.modelStarted.get(id) ?? ended - ms;
    this.modelStarted.delete(id);
    const firstOutputMs = count(event.performance?.timeToFirstOutputMs), inputTokens = count(event.usage?.inputTokens), outputTokens = count(event.usage?.outputTokens);
    const cacheReadTokens = count(event.usage?.inputTokenDetails?.cacheReadTokens), cacheWriteTokens = count(event.usage?.inputTokenDetails?.cacheWriteTokens);
    this.entries.push({ step, kind: 'model', at, ms, ...(firstOutputMs !== undefined ? { firstOutputMs } : {}), ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}), ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}) });
  }

  toolStart(id: string, name: string, input: unknown) { this.toolStarted.set(id, { at: this.now(), name, key: argumentKey(input) }); }

  toolEnd(id: string, step: number, ms: number | undefined, failed: boolean) {
    const started = this.toolStarted.get(id);
    if (!started) return;
    this.toolStarted.delete(id);
    this.entries.push({ step, kind: 'tool', name: started.name, at: started.at, ms: count(ms) ?? Math.max(0, this.now() - started.at), key: started.key, ...(failed ? { failed: true } : {}) });
  }

  drain() { const entries = this.entries; this.entries = []; return entries; }
}
