import type { LanguageModelV4Prompt, LanguageModelV4ToolResultOutput } from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import type { Timeline, MediaAsset } from '../editor/types';

export const EDITOR_CONTEXT_NOTICE = 'Context loads the latest 100 saved messages plus associated steps needed to complete their tool calls. Older messages or superseded timeline snapshots may be omitted. Omission is not evidence that an event or edit is absent. Preserve recent user constraints and use the current timeline. Visual observations and images in this context remain intact. Before a creative decision needing absent visual evidence, inspect the relevant source window again (saved analysis may be reused). Read inspectClip for omitted motion/focus samples; never reconstruct source trims from a summary.';
export const EDITOR_CONTEXT_BOUNDARY = '\nCURRENT EDIT CONTEXT:\n';

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
  return { ...timeline, clips: timeline.clips.map(clip => {
    const { motion, focus, scene, ...settings } = clip;
    return { ...settings,
      ...(motion ? selected.has(clip.id) || motion.length <= 16 ? { motion } : { motionSummary: { sampleCount: motion.length, detailsOmitted: true, readTool: 'inspectClip' } } : {}),
      ...(focus ? { focusSummary: { sampleCount: focus.length, detailsOmitted: true, readTool: 'inspectClip' } } : {}),
      // Compacted history can hold timelines whose scene code was already summarized.
      ...(scene ? selected.has(clip.id) || typeof scene.code !== 'string' ? { scene } : { scene: { title: scene.title, codeCharacters: scene.code.length, detailsOmitted: true, readTool: 'inspectClip' } } : {}),
    };
  }) };
}

/** Keep verbal/visual evidence. Dense numerical maps can be read by source range. */
export function modelAssetAnalysis(analysis: NonNullable<MediaAsset['analysis']>, window?: { start: number; end: number }) {
  const { focus, beats, transcript, audioActivity, shots, speechCleanup, ...observations } = analysis;
  const inRange = (time: number) => !window || (time >= window.start && time <= window.end);
  const denseRead = (count: number) => ({ sampleCount: count, detailsOmitted: true, readTool: 'inspectAssetAnalysis with start/end SOURCE seconds' });
  return { ...observations,
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
  return { ...shared, ...(audioActivity ? { audioActivity: audioLevels } : {}),
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

/** Keep call/result pairs, receipts, user constraints and all multimodal evidence.
 * Only obsolete timeline snapshots and dense timeline samples are compacted.
 * Applying this at the provider boundary also covers tool results in this run.
 */
/** Earlier turns keep a scene's title and size; inspectClip returns its current code. */
const SCENE_TOOLS = new Set(['addScene', 'addScenes', 'editScene']);
function sceneCodeNote(code: string) { return `[${code.length} characters of earlier scene code omitted; inspectClip returns the current code]`; }
/** A scene call's input with its code, film kit and each batched scene's code reduced to their sizes. */
function withoutInputCode(input: Record<string, unknown>): Record<string, unknown> {
  const code = (value: unknown) => typeof value === 'string' ? sceneCodeNote(value) : value;
  if (typeof input.code !== 'string' && typeof input.kit !== 'string' && !Array.isArray(input.scenes)) return input;
  return { ...input, ...(input.code !== undefined ? { code: code(input.code) } : {}), ...(input.kit !== undefined ? { kit: code(input.kit) } : {}), ...(Array.isArray(input.scenes) ? { scenes: input.scenes.map(scene => object(scene) ? { ...scene, code: code(scene.code) } : scene) } : {}) };
}
function withoutSceneCode(clip: unknown): unknown {
  if (!object(clip) || !object(clip.scene) || typeof clip.scene.code !== 'string') return clip;
  return { ...clip, scene: { ...clip.scene, code: sceneCodeNote(clip.scene.code) } };
}

export function compactEditorPrompt(prompt: LanguageModelV4Prompt, selectedClipIds: readonly string[] = [], initialRevision?: number): LanguageModelV4Prompt {
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
      if (part.type === 'tool-call' && index < lastUser && SCENE_TOOLS.has(part.toolName) && object(part.input)) { const compacted = withoutInputCode(part.input); if (compacted !== part.input) return { ...part, input: compacted }; }
      if (part.type !== 'tool-result') return part;
      const value = timelineOutput(part.output);
      if (!value) return part;
      let projected = value;
      if (index < lastUser && (object(value.clip) || Array.isArray(value.changedClips))) projected = { ...projected, ...(object(value.clip) ? { clip: withoutSceneCode(value.clip) } : {}), ...(Array.isArray(value.changedClips) ? { changedClips: value.changedClips.map(withoutSceneCode) } : {}) };
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
