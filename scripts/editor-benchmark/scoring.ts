import type { Clip, Timeline } from '../../lib/editor/types';

export const BENCHMARK_MODELS = ['claude-sonnet-5-5', 'gpt-6.1-sol'] as const;
export type BenchmarkModel = typeof BENCHMARK_MODELS[number];
export type CaseName = 'precise-cuts' | 'subtitles' | 'styled-edit';
export type Transcript = { segments: { start: number; end: number; text: string }[]; words: { start: number; end: number; text: string }[] };
export type Check = { name: string; passed: boolean; detail?: string };
export type StoredMessage = {
  _id: string; model?: string; provider?: string; status?: string; order?: number; stepOrder?: number;
  message?: { role: string; content?: unknown }; usage?: Record<string, unknown>; providerMetadata?: Record<string, unknown>;
};
export class BenchmarkGuardError extends Error {}
const near = (a: number | undefined, b: number, tolerance = 1 / 24 / 2) => a !== undefined && Math.abs(a - b) <= tolerance;
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const duration = (timeline: Timeline) => Math.max(0, ...timeline.clips.map(clip => clip.start + clip.duration));
const visual = (timeline: Timeline) => timeline.clips.filter(clip => clip.kind === 'video');

export function initialTimeline(caseName: CaseName, assetId: string, speechDuration: number): Timeline {
  return { fps: 24, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 1 }, clips: [
    { id: 'benchmark-source', kind: 'video', assetId, track: 1, start: 0, duration: caseName === 'subtitles' ? speechDuration : 6, sourceStart: 0, volume: 1 },
  ] };
}

export function casePrompt(caseName: CaseName, speechDuration: number) {
  const common = 'Make the edit and save the finished timeline. Do not ask follow-up questions. Keep the existing source audio, 24 fps and landscape aspect ratio. Use the saved media analysis; no new analysis or stock media is needed. ';
  if (caseName === 'precise-cuts') return common + 'Keep exactly two source ranges from the existing video: source 1.000–2.500 seconds followed immediately by source 4.000–5.250 seconds. Put them at timeline 0.000–1.500 and 1.500–2.750 seconds. Remove every other part. Use normal speed and hard cuts, with no transition, text, effect, gap or overlap. Final duration must be exactly 2.750 seconds.';
  if (caseName === 'subtitles') return common + `Keep the existing ${speechDuration.toFixed(3)}-second video unchanged. Add accurate subtitles using the already saved transcript. Make exactly one caption per transcript segment that falls in this clip, using the segment's exact text and source start/end times (clip any final segment to the video end). Use readable white text, centered horizontally at y=0.85, font size 48, with no animation. Do not paraphrase, add a title, trim footage or change the audio.`;
  return common + 'Keep the existing single six-second video unchanged in position, trim, speed and audio. Give that video a 0.250-second visual fade-in and a 0.250-second visual fade-out. Add exactly one title with the exact text READY TO MOVE from timeline 0.500 to 3.500 seconds. Use white (#FFFFFF), Space Grotesk, font size 72, horizontally centered at x=0.5 and y=0.22, with the Rise text animation. Do not add other clips or effects. The finished duration must remain 6.000 seconds.';
}

export function scoreTimeline(caseName: CaseName, timeline: Timeline, initial: Timeline, transcript?: Transcript): Check[] {
  const videos = visual(timeline).sort((a, b) => a.start - b.start);
  const captions = timeline.clips.filter(clip => clip.kind === 'caption' || clip.kind === 'graphic').sort((a, b) => a.start - b.start);
  const source = initial.clips[0];
  const checks: Check[] = [
    { name: 'format preserved', passed: timeline.fps === 24 && timeline.aspectRatio === 'landscape' },
    { name: 'original media retained', passed: videos.length > 0 && videos.every(clip => clip.assetId === source.assetId) },
    { name: 'normal speed and original audio', passed: videos.every(clip => near(clip.playbackRate ?? 1, 1, 1e-6) && near(clip.volume ?? 1, 1, 1e-6)) },
  ];
  if (caseName === 'precise-cuts') {
    const ranges = [[0, 1.5, 1], [1.5, 1.25, 4]];
    checks.push({ name: 'exact source and timeline ranges', passed: videos.length === 2 && videos.every((clip, i) => near(clip.start, ranges[i][0]) && near(clip.duration, ranges[i][1]) && near(clip.sourceStart, ranges[i][2])) });
    checks.push({ name: 'hard cuts without extra clips or effects', passed: timeline.clips.length === 2 && videos.every(clip => !hasEffects(clip)) });
    checks.push({ name: 'exact final duration', passed: near(duration(timeline), 2.75) });
  } else {
    checks.push({ name: 'source arrangement unchanged', passed: videos.length === 1 && near(videos[0].start, source.start) && near(videos[0].sourceStart, source.sourceStart) && near(videos[0].duration, source.duration) });
    checks.push({ name: 'final duration preserved', passed: near(duration(timeline), source.duration) });
    if (caseName === 'subtitles') {
      const segments = transcript?.segments.filter(segment => segment.start < source.duration && segment.end > 0) ?? [];
      checks.push({ name: 'all transcript segments captioned exactly', passed: segments.length > 0 && captions.length === segments.length && captions.every((clip, i) => tokens(clip.text ?? '').join(' ') === tokens(segments[i].text).join(' ')) });
      checks.push({ name: 'captions follow saved transcript timing', passed: captions.length === segments.length && captions.every((clip, i) => near(clip.start, segments[i].start, 0.1) && near(clip.start + clip.duration, Math.min(segments[i].end, source.duration), 0.1)) });
      checks.push({ name: 'readable subtitle placement and style', passed: captions.length > 0 && captions.every(clip => near(clip.x ?? 0.5, 0.5, 0.01) && near(clip.y, 0.85, 0.01) && near(clip.fontSize, 48, 0.1) && /^#fff(?:fff)?$/i.test(clip.color ?? '') && (!clip.animation || clip.animation === 'none')) });
      checks.push({ name: 'no extra footage or overlays', passed: timeline.clips.length === 1 + captions.length && videos.every(clip => !hasEffects(clip)) });
    } else {
      const title = captions[0];
      checks.push({ name: 'exact title and timing', passed: captions.length === 1 && title.text === 'READY TO MOVE' && near(title.start, 0.5) && near(title.duration, 3) });
      checks.push({ name: 'requested title style and motion', passed: captions.length === 1 && near(title.x, 0.5, 0.01) && near(title.y, 0.22, 0.01) && near(title.fontSize, 72, 0.1) && title.fontFamily === 'space-grotesk' && /^#fff(?:fff)?$/i.test(title.color ?? '') && title.animation === 'rise' });
      checks.push({ name: 'requested source fades', passed: videos.length === 1 && near(videos[0].visualFade?.fadeIn, 0.25) && near(videos[0].visualFade?.fadeOut, 0.25) });
      checks.push({ name: 'source appearance preserved apart from fades', passed: videos.length === 1 && !hasEffects({ ...videos[0], visualFade: undefined }) });
      checks.push({ name: 'no extra clips', passed: timeline.clips.length === 2 });
    }
  }
  return checks;
}

function hasEffects(clip: Clip) {
  const transform = clip.transform;
  const changedTransform = transform && (!near(transform.x, 0.5, 1e-6) || !near(transform.y, 0.5, 1e-6) || !near(transform.scale, 1, 1e-6) || !near(transform.rotation, 0, 1e-6) || !near(transform.opacity, 1, 1e-6));
  return Boolean(changedTransform || (clip.crop && Object.values(clip.crop).some(value => Math.abs(value) > 1e-6)) || clip.focus?.length || clip.fit === 'contain' ||
    clip.transition || (clip.visualFade && (clip.visualFade.fadeIn > 0 || clip.visualFade.fadeOut > 0)) || clip.motion?.length || (clip.effectPreset && clip.effectPreset !== 'none') ||
    clip.colorGrade?.enabled || clip.zoomBlur?.enabled || clip.glitch?.enabled || clip.invert?.enabled || clip.dither?.enabled ||
    clip.zoom || clip.shake || clip.punch || clip.pop || clip.flash || clip.frameShrink || clip.cinematicBars ||
    clip.neonEdges?.enabled || clip.softBlur?.enabled || clip.frameCorners?.enabled || clip.lensDistortion?.enabled || clip.frameDistortion?.enabled ||
    clip.filmOverlay?.enabled || clip.directionalBlur?.enabled || clip.turbulentDisplace?.enabled || clip.lightSweep?.enabled || clip.vhs?.enabled || clip.lightLeak?.enabled);
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BenchmarkGuardError('Missing or invalid provider usage. Further runs are blocked.');
  return value;
}

/** Uses stored per-call totals, including reasoning output and cache writes.
 * Prices are supplied by this benchmark's reviewed 2026-10-15 plan, USD / 1M.
 * No provider metadata, message text or private reasoning is written to results.
 */
export function summarizeUsage(messages: StoredMessage[], expectedModel: BenchmarkModel) {
  const calls = messages.filter(message => message.message?.role === 'assistant' && !(message.providerMetadata?.revline as { publicationReceipt?: unknown } | undefined)?.publicationReceipt);
  if (!calls.length) throw new BenchmarkGuardError('No provider usage was persisted. Further runs are blocked.');
  const ids = new Set<string>();
  const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 0, usd: 0 };
  const callUsage = calls.map(message => {
    if (ids.has(message._id)) throw new BenchmarkGuardError('Duplicate usage message. Further runs are blocked.');
    ids.add(message._id);
    const usage = message.usage;
    if (!usage) throw new BenchmarkGuardError('Missing provider usage. Further runs are blocked.');
    // Gateway Sonnet has an explicit namespaced model ID in Agent storage.
    if (message.model !== expectedModel && !(expectedModel === 'claude-sonnet-5-5' && message.model === 'anthropic/claude-sonnet-5.5')) throw new BenchmarkGuardError('Stored provider model does not match the pinned benchmark model.');
    const anthropic = message.providerMetadata?.anthropic as { iterations?: { type?: string; model?: string }[] } | undefined;
    if (anthropic?.iterations?.some(iteration => iteration.type === 'advisor_message' || (iteration.model && iteration.model !== expectedModel))) throw new BenchmarkGuardError('Additional provider sub-inference or a fallback model prevents reliable benchmark cost attribution.');
    const inputTokens = count(usage.promptTokens), outputTokens = count(usage.completionTokens);
    const cacheReadTokens = count(usage.cachedInputTokens ?? 0), cacheWriteTokens = count(usage.cacheWriteInputTokens ?? 0);
    const uncachedInputTokens = usage.nonCachedInputTokens === undefined ? inputTokens - cacheReadTokens - cacheWriteTokens : count(usage.nonCachedInputTokens);
    if (uncachedInputTokens < 0 || uncachedInputTokens + cacheReadTokens + cacheWriteTokens !== inputTokens) throw new BenchmarkGuardError('Provider input token categories do not reconcile. Further runs are blocked.');
    const reasoningTokens = count(usage.reasoningTokens ?? 0);
    if (reasoningTokens > outputTokens) throw new BenchmarkGuardError('Provider reasoning tokens exceed output usage.');
    const longContext = expectedModel === 'gpt-6.1-sol' && inputTokens > 272_000;
    const inputMultiplier = longContext ? 2 : 1, outputMultiplier = longContext ? 1.5 : 1;
    const usd = (uncachedInputTokens * 2 * inputMultiplier + cacheReadTokens * 0.1 * inputMultiplier + cacheWriteTokens * 2.5 * inputMultiplier + outputTokens * 10 * outputMultiplier) / 1_000_000;
    const row = { model: message.model!, provider: message.provider, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, uncachedInputTokens, usd, longContext };
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += row[key];
    return row;
  });
  return { ...totals, calls: callUsage };
}

export class CostLedger {
  spentUsd = 0;
  reservedUsd = 0;
  blocked = false;
  constructor(readonly ceilingUsd: number, readonly perRunReserveUsd: number) {
    if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || perRunReserveUsd !== 1.68) throw new BenchmarkGuardError('Use a positive cost ceiling and the conservative $1.68 per-run reservation.');
  }
  reserve() {
    if (this.blocked || this.reservedUsd || this.spentUsd + this.perRunReserveUsd > this.ceilingUsd + 1e-9) throw new BenchmarkGuardError('Cost ceiling or missing usage blocks the next run.');
    this.reservedUsd = this.perRunReserveUsd;
  }
  settle(usd: number) {
    if (!this.reservedUsd || !Number.isFinite(usd) || usd < 0 || usd > this.reservedUsd + 1e-9) { this.blocked = true; throw new BenchmarkGuardError('Usage exceeds the reviewed reservation. Further runs are blocked.'); }
    this.spentUsd += usd; this.reservedUsd = 0;
  }
  failClosed() { this.blocked = true; }
}
