import { audioNormalizationKey, timelineNormalizationKey } from '../editor/audio-normalization';
import type { LanguageModelV4Prompt, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import type { Timeline, MediaAsset } from '../editor/types';
import { summarizeSpeakerFraming } from '../media-analysis/clipping';
import { readHighlights } from '../media-analysis/highlights';
import { z } from 'zod';

const projectedNormalization = z.object({ assetId: z.string(), targetLufs: z.number(), truePeakCeiling: z.number(), active: z.boolean() }).strict();

function modelNormalization(value: NonNullable<Timeline['audioNormalization']>, active: () => boolean) {
  if (!('key' in value)) {
    const projected = projectedNormalization.safeParse(value);
    if (projected.success) return projected.data;
  }
  return { assetId: value.assetId, targetLufs: value.targetLufs, truePeakCeiling: value.truePeak, active: active() };
}

export const EDITOR_CONTEXT_NOTICE = 'Earlier requests in this chat show only what the user asked, what the assistant answered, and a server line from their turn record (finished or not, timeline revision, edits saved, failure reason). Their tool calls and results are left out: the current timeline and media below are the truth, and saved analysis is one tool call away. Omission is not evidence that an event or edit is absent. Preserve recent user constraints and use the current timeline. Before a creative decision needing absent visual evidence, inspect the relevant source window again (saved analysis may be reused). Read inspectClip for omitted motion/focus samples; never reconstruct source trims from a summary.';
export const EDITOR_CONTEXT_BOUNDARY = '\nCURRENT EDIT CONTEXT:\n';
export const OPTIONAL_UNDERSTANDING_NOTE = 'Scene understanding is optional and unavailable here; it is intentionally skipped for footage with meaningful speech. Continue with saved transcript and audio evidence; for visual evidence use readFrames and inspect the returned frames yourself. Do not wait for or repeatedly request an overview, and never invent unseen events. This does not block editing or require a user-facing error.';

/** Agent contextHandler messages are ephemeral. Keep the instruction/history
 * prefix unchanged when the server asks the same request to finish a repair. */
export function editorRepairContext(messages:ModelMessage[],feedback:string):ModelMessage[] {
  return [...messages,{role:'system',content:`# Finish the current request\n${feedback.slice(0,16_000)}`}];
}

function withoutDiagnostics<T extends { providerOptions?: LanguageModelV4Prompt[number]['providerOptions'] }>(value: T): T {
  const anthropic = value.providerOptions?.anthropic;
  if (!anthropic) return value;
  // These response-only statistics are ignored by the Anthropic prompt encoder.
  // Keep signatures, cache controls, citations and every other provider option.
  const { usage: _usage, iterations: _iterations, inputTransformations: _transforms, contextManagement: _management, stopSequence: _stop, ...options } = anthropic;
  return { ...value, providerOptions: { ...value.providerOptions, anthropic: options } };
}

/** A read-only model projection; the edit session retains every source sample. */
export function modelTimeline(timeline: Timeline, selectedClipIds: readonly string[] = []) {
  const selected = new Set(selectedClipIds);
  return { ...timeline,...(timeline.audioNormalization?{audioNormalization:modelNormalization(timeline.audioNormalization,()=>timeline.audioNormalization?.key===timelineNormalizationKey(timeline))}:{}), clips: timeline.clips.map(clip => {
    const { motion, focus, scene, normalizedAudio, ...settings } = clip;
    return { ...settings,
      ...(normalizedAudio?{normalizedAudio:modelNormalization(normalizedAudio,()=>normalizedAudio.key===audioNormalizationKey(timeline,clip))}:{}),
      ...(motion ? selected.has(clip.id) || motion.length <= 16 ? { motion } : { motionSummary: { sampleCount: motion.length, detailsOmitted: true, readTool: 'inspectClip' } } : {}),
      ...(focus ? { focusSummary: { sampleCount: focus.length, detailsOmitted: true, readTool: 'inspectClip' } } : {}),
      ...(scene ? { unsupported: 'Scene clips are no longer supported: this clip draws nothing in preview or export. Delete it when the user asks to clean up.' } : {}),
    };
  }) };
}

/** Preserve every editorial moment; dense RMS/quiet data is read by source window. */
function modelHighlightAnalysis(value: string, windows: readonly { start: number; end: number }[] = []) {
  const tracks = readHighlights(value);
  if (!tracks) return value;
  const { levels, signals, ...evidence } = tracks;
  return { ...evidence, audioHelpers: { levelStep: tracks.levelStep, levelCount: levels.length, signalCount: signals.length,
    readTool: 'inspectAssetAnalysis with start/end or windows in SOURCE seconds' },
    ...(windows.length ? { signals: signals.filter(s => windows.some(w => s.end >= w.start && s.start <= w.end)),
      levelWindows: windows.map(w => { const first = Math.floor(w.start / tracks.levelStep), last = Math.ceil(w.end / tracks.levelStep);
        return { start: first * tracks.levelStep, step: tracks.levelStep, levels: levels.slice(first, last + 1) }; }) } : {}) };
}

/** Keep verbal/visual evidence. Dense numerical maps can be read by source range. */
export function modelAssetAnalysis(analysis: NonNullable<MediaAsset['analysis']>, window?: { start: number; end: number }) {
  const { focus, beats, transcript, audioActivity, shots, speechCleanup, speakers, facecam, highlights, ...observations } = analysis;
  const inRange = (time: number) => !window || (time >= window.start && time <= window.end);
  const denseRead = (count: number) => ({ sampleCount: count, detailsOmitted: true, readTool: 'inspectAssetAnalysis with start/end SOURCE seconds' });
  return { ...observations,
    ...(highlights ? { highlights: modelHighlightAnalysis(highlights, window ? [window] : []) } : {}),
    ...(!analysis.understanding ? { understandingNote: OPTIONAL_UNDERSTANDING_NOTE } : {}),
    ...(facecam?{facecam:{...facecam,samples:window?facecam.samples.filter(s=>s.time>=window.start&&s.time<=window.end):facecam.samples}}:{}),
    ...(speakers?{speakers:{version:speakers.version,start:speakers.start,end:speakers.end,identityScope:speakers.identityScope,framingSummary:summarizeSpeakerFraming(speakers,window?.start,window?.end),...(window?{turns:speakers.turns.filter(t=>t.end>=window.start&&t.start<=window.end)}:{turnCount:speakers.turns.length,speakerIds:[...new Set(speakers.turns.map(t=>t.speaker))],turnSamples:denseRead(speakers.turns.length)}),focusSummary:denseRead(speakers.focus.length),...(window?{focus:speakers.focus.filter(s=>inRange(s.time)),...(speakers.version===2?{framing:speakers.framing.filter(frame=>frame.end>window.start&&frame.start<window.end)}:{})}:{})}}:{}),
    ...(window ? { sourceWindow: window } : {}),
    ...(transcript ? { transcript: {
      segments: transcript.segments.filter(segment => !window || (segment.end >= window.start && segment.start <= window.end)),
      wordCount: transcript.words.length,
      ...(window ? { words: transcript.words.filter(word => word.end >= window.start && word.start <= window.end) }
        : { wordTimingSummary: { ...denseRead(transcript.words.length), suggestedMaxWindowSeconds: 30 } }),
    } } : {}),
    ...(audioActivity ? { audioActivity: {
      version: audioActivity.version, reliable: audioActivity.reliable, level: audioActivity.level,
      basis: 'Measured source audio energy; quiet intervals do not prove silence or spoken content. Provider word times remain unchanged.',
      ...(window ? { quiet: audioActivity.quiet.filter(interval => interval.end >= window.start && interval.start <= window.end) }
        : { quietSummary: denseRead(audioActivity.quiet.length) }),
    } } : {}),
    // Speech cuts apply the cleanup map themselves; the model only needs to know it exists.
    ...(speechCleanup ? { speechCleanup: { measured: true, cutCount: speechCleanup.cuts.length, appliedBy: 'retainSourceRanges with tightenSilence:true, or cleanSpeech' } } : {}),
    ...(shots ? { shots } : {}),
    ...(focus ? window ? { focus: focus.filter(sample => inRange(sample.time)) } : { focusSummary: denseRead(focus.length) } : {}),
    ...(beats ? { beats: { bpm: beats.bpm, confidence: beats.confidence, engine: beats.engine,
      ...(window ? { beats: beats.beats.filter(inRange), downbeats: beats.downbeats?.filter(inRange), accents: beats.accents?.filter(hit => inRange(hit.time)), dropCandidates: beats.dropCandidates?.filter(hit => inRange(hit.time)) }
        : { beatSamples: denseRead(beats.beats.length), downbeatSamples: denseRead(beats.downbeats?.length ?? 0), accentSamples: denseRead(beats.accents?.length ?? 0), dropCandidates: beats.dropCandidates }),
    } } : {}),
  };
}

/** Several source windows in one read: shared observations and audio levels
 * once, then each window's words, quiet intervals and dense samples. */
export function modelAssetAnalysisWindows(analysis: NonNullable<MediaAsset['analysis']>, windows: readonly { start: number; end: number }[]) {
  const reads = windows.map(window => modelAssetAnalysis(analysis, window));
  const { sourceWindow: _window, transcript: _transcript, audioActivity, focus: _focus, beats: _beats, ...shared } = reads[0] as Record<string, unknown> & { audioActivity?: { quiet?: unknown } };
  const { quiet: _quiet, ...audioLevels } = audioActivity ?? {};
  return { ...shared, ...(analysis.highlights ? { highlights: modelHighlightAnalysis(analysis.highlights, windows) } : {}), ...(audioActivity ? { audioActivity: audioLevels } : {}),
    windows: reads.map(read => { const { sourceWindow, transcript, audioActivity: activity, focus, beats } = read as Record<string, unknown> & { audioActivity?: { quiet?: unknown } };
      return { sourceWindow, ...(transcript ? { transcript } : {}), ...(activity?.quiet ? { quiet: activity.quiet } : {}), ...(focus ? { focus } : {}), ...(beats ? { beats } : {}) }; }),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timelineOutput(output: LanguageModelV4ToolResultOutput): Record<string, unknown> | undefined {
  if (output.type === 'json' && object(output.value)) return output.value;
  if (output.type === 'text') {
    try { const parsed: unknown = JSON.parse(output.value); if (object(parsed)) return parsed; } catch { /* Plain text is preserved. */ }
  }
}


export function compactEditorPrompt(prompt: LanguageModelV4Prompt, selectedClipIds: readonly string[] = [], initialRevision?: number): LanguageModelV4Prompt {
  // Full-source fallback transcripts only. Exact serialized keys avoid hash collisions.
  // Reset at every user boundary so history fitting removes references with their evidence.
  const transcripts = new Map<string, string>();
  let latestTimelineCall: string | undefined;
  const latestClipState = new Map<string, string>();
  const latestRead = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();
  let lastUser = -1;
  for (let index = prompt.length - 1; index >= 0; index--) if (prompt[index].role === 'user') { lastUser = index; break; }
  for (const message of prompt) if (message.role !== 'system') for (const part of message.content) if (part.type === 'tool-call') toolInputs.set(part.toolCallId, part.input);
  const readKey = (tool: string, id: string, value: unknown) => tool + JSON.stringify(toolInputs.get(id)) + JSON.stringify(value);
  for (const [index, message] of prompt.entries()) {
    if (message.role === 'system') continue;
    for (const part of message.content) {
      if (part.type === 'tool-result' && (part.toolName === 'inspectTimeline' || part.toolName === 'undoLatestEdit')) {
        const value = timelineOutput(part.output);
        if (object(value?.timeline) && Array.isArray(value.timeline.clips) && (initialRevision === undefined || index >= lastUser)) latestTimelineCall = part.toolCallId;
      }
      if (part.type !== 'tool-result') continue;
      const value = timelineOutput(part.output);
      if (Array.isArray(value?.changedClips)) for (const clip of value.changedClips) if (object(clip) && typeof clip.id === 'string') latestClipState.set(clip.id, part.toolCallId);
      // Exact duplicate JSON read results only; never compact image content or
      // a distinct observation/question/window. Keep the newest copy intact.
      if (part.toolName === 'inspectAssetAnalysis') {
        if (value && part.output.type !== 'content') latestRead.set(readKey(part.toolName, part.toolCallId, value), part.toolCallId);
      }
    }
  }
  // The per-request context (current prompt, recovery, continuation) follows the
  // latest user message. Ahead of the history it changed every request's prefix,
  // so no saved turn was ever read from the provider cache by the next request.
  let requestContext: LanguageModelV4Prompt[number] | undefined;
  const compacted = prompt.flatMap<LanguageModelV4Prompt[number]>((message, index) => {
    if (message.role === 'user') transcripts.clear();
    message = withoutDiagnostics(message);
    if (message.role === 'system') {
      const boundary = message.content.indexOf(EDITOR_CONTEXT_BOUNDARY);
      if (boundary <= 0) return [message];
      requestContext = { ...message, content: message.content.slice(boundary) };
      return [{ ...message, content: message.content.slice(0, boundary), providerOptions: { ...message.providerOptions, anthropic: { ...message.providerOptions?.anthropic, cacheControl: { type: 'ephemeral', ttl: '5m' } } } }];
    }
    // Old private reasoning is not saved visual evidence or user constraints.
    // Keep this run's signed reasoning blocks so tool continuations stay valid.
    const content = message.role === 'assistant' && index < lastUser ? message.content.filter(part => part.type !== 'reasoning' && !(part.type === 'custom' && part.kind === 'anthropic.message_start')) : message.content;
    if (!content.length) return [];
    return { ...message, content: content.map(original => {
      const part = withoutDiagnostics(original);
      if (part.type !== 'tool-result') return part;
      const value = timelineOutput(part.output);
      if (!value) return part;
      let projected = value;
      if (part.toolName === 'findHighlights' && Array.isArray(value.transcript) && value.transcript.length) {
        const input = toolInputs.get(part.toolCallId);
        // Require the call and receipt to agree on source; preserve unknown/windowed shapes.
        if (object(input) && typeof value.assetId === 'string' && input.assetId === value.assetId &&
          !['start', 'end', 'windows', 'sourceWindow'].some(key => key in input || key in value)) {
          const key = JSON.stringify([value.assetId, value.transcript]);
          const retained = transcripts.get(key);
          if (retained && retained !== part.toolCallId) projected = { ...value, transcript: {
            retainedToolCallId: retained, field: 'transcript',
            note: 'Identical complete transcript for this source is retained in the earlier tool result in this user turn.',
          } };
          else transcripts.set(key, part.toolCallId);
        }
      }
      if (part.toolName === 'inspectVideo' && Array.isArray(value.matches) && Array.isArray(value.timelineOccurrences)) {
        // Keep every original visual observation once; mapped occurrences retain
        // exact source/timeline timing and point to their original description.
        const descriptions = value.matches.map(match => object(match) ? match.description : undefined);
        projected = initialRevision !== undefined && index < lastUser
          ? { ...value, timelineOccurrences: undefined, timelineMappingOmitted: 'Historical clip mappings may be stale. Map these preserved source matches through the current timeline.' }
          : { ...value, timelineOccurrences: value.timelineOccurrences.map(occurrence => {
          if (!object(occurrence) || !Array.isArray(occurrence.matches)) return occurrence;
          return { ...occurrence, matches: occurrence.matches.map(match => {
            if (!object(match) || typeof match.description !== 'string') return match;
            const observationIndex = descriptions.indexOf(match.description);
            if (observationIndex < 0) return match;
            const { description: _description, ...times } = match;
            return { ...times, observationIndex };
          }) };
        }) };
      }
      if (part.toolName === 'inspectAssetAnalysis' && typeof value.highlights === 'string') {
        const input = toolInputs.get(part.toolCallId);
        const windows = object(input) && Array.isArray(input.windows) ? input.windows
          : object(input) && typeof input.start === 'number' && typeof input.end === 'number' ? [input] : [];
        const ranges = windows.filter((w): w is { start: number; end: number } => object(w) && typeof w.start === 'number' && typeof w.end === 'number');
        projected = { ...projected, highlights: modelHighlightAnalysis(value.highlights, ranges) };
      }
      if (part.toolName === 'inspectAssetAnalysis' && part.toolCallId !== latestRead.get(readKey(part.toolName, part.toolCallId, value))) {
        projected = { assetId: value.assetId, start: value.start, end: value.end, question: value.question,
          duplicateReadOmitted: 'Identical saved evidence is retained in the latest read result.', latestToolCallId: latestRead.get(readKey(part.toolName, part.toolCallId, value)) };
      }
      if (Array.isArray(value.changedClips)) projected = { ...projected, changedClips: (projected.changedClips as unknown[]).map(clip => {
        if (!object(clip) || typeof clip.id !== 'string' || latestClipState.get(clip.id) === part.toolCallId) return clip;
        return { id: clip.id, kind: clip.kind, assetId: clip.assetId, track: clip.track, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, playbackRate: clip.playbackRate,
          previousSettingsOmitted: true, latestToolCallId: latestClipState.get(clip.id) };
      }) };
      if ((part.toolName === 'inspectTimeline' || part.toolName === 'undoLatestEdit') && object(value.timeline) && Array.isArray(value.timeline.clips)) {
        projected = part.toolCallId === latestTimelineCall
          ? { ...value, timeline: modelTimeline(value.timeline as Timeline, selectedClipIds) }
          : { revision: value.revision, staged: value.staged, saved: value.saved, applied: value.applied, undone: value.undone,
              snapshotOmitted: 'Historical or superseded timeline snapshot. Use the current project or inspectTimeline again.', latestToolCallId: latestTimelineCall, currentProjectRevision: initialRevision };
      }
      if (projected === value) return part;
      // Keep the original output kind for providers and persisted tool-call IDs.
      return { ...part, output: part.output.type === 'text'
        ? { ...part.output, value: JSON.stringify(projected) }
        : { ...part.output, value: JSON.parse(JSON.stringify(projected)) } };
    }) } as typeof message;
  });
  if (!requestContext) return compacted;
  let latestUser = -1;
  for (let index = compacted.length - 1; index >= 0; index--) if (compacted[index].role === 'user') { latestUser = index; break; }
  return latestUser < 0 ? [...compacted, requestContext] : [...compacted.slice(0, latestUser + 1), requestContext, ...compacted.slice(latestUser + 1)];
}
