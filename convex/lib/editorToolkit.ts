import { processorCan } from './processor_capabilities';
import { stepOrderGuard } from '../../lib/ai/tool-guards';
import { retryAbortedTransaction } from './retry_aborted_transaction';
import { materializeTranscript, type Transcript } from '../../lib/media-analysis/transcript';
import { forEachLimited } from '../../lib/server/run-limited';
import { LANES, capabilityExists, capabilitySummary, discoverCapabilities, laneToolAllowed, laneToolError, laneSkill, laneInstructions, type LaneId } from '../../lib/ai/lanes';
import { LANE_IDS } from '../../lib/ai/lanes/types';
import { timelineHistoryKey } from '../../lib/editor/timeline-history-key';
import { laneBaseline, MAX_FINISH_ATTEMPTS, MAX_FINISH_CHECKS } from '../../lib/ai/lanes/task';
import { exhaustedLaneError, exhaustedNext, finishLane, FramesUnavailableError, type FinishResult } from './laneFinish';
import { safely } from './safely';
import type { EditorRun, LaneTaskFields } from './run_types';
import { snapshotFrames } from '../../lib/ai/snapshot-frames';
import { impactSettingsSchema, overlaySettingsSchema, parallaxSettingsSchema, DEFAULT_IMPACT, DEFAULT_OVERLAY, DEFAULT_PARALLAX, vfxDuration } from '../../lib/editor/montage-vfx';
import { pixelTrackRequest, trackSeed, type PixelTrackRequest } from '../../lib/media-analysis/pixel-track';
import { audioNormalizationKey, timelineNormalizationKey } from '../../lib/editor/audio-normalization';
import { HIGHLIGHT_SIGNALS_ONLY, readHighlights, sourceType, semanticMoment } from '../../lib/media-analysis/highlights';
import { clipCheckResult } from '../../lib/media-analysis/clip-check';
import { completionRepairFeedback } from '../../lib/ai/tool-failures';
import { runFailure, type RunFailureCode } from '../../lib/ai/run-failure';
import { CHOICE_TEXT, fitChoiceText, shortenedNote } from '../../lib/ai/choice-text';
import { LIMITATION_CATEGORIES, LIMITATION_IMPACTS } from '../../lib/incidents';
import { BOUNDED_READ_REFUSAL, FULL_CHECK_TOOLS, changedFrameLimit, checkInstructions, fullCheckRefusal, laneChecks, tracksChangedFrames } from '../../lib/ai/lanes/checks';
import { MAX_SHEET_FRAMES, MAX_ZOOM_FRAMES, sampleFrameTimes } from '../../lib/ai/frame-sampling';
import type { CheckLevel } from '../../lib/ai/lanes/types';
import { captionSyncFailures, followSpeechCaptions, retainedSpeechWords } from '../../lib/ai/lanes/reel/check';
import { CUT_FAILING_KINDS, CUT_READ_ROUNDS, CUT_READING, cutFlagFails, cutProse, cutScript, cutSignature, cutWordsRemoval } from '../../lib/ai/lanes/reel/cut-script';
import { FastFrameReview, fastReelFrameMoments, speechCutMoments, readFastFrameTimes, fastFrameEvidence } from '../../lib/ai/fast-frame-review';
import { effectPlanInput,validateEffectPlan,mergeEffectPlans,effectReviewBindings,type EffectPlan,type EffectEvidence } from '../../lib/ai/edit-plan';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { applyTwoRowLayout } from '../../lib/editor/two-row-layout';
import { applyMirrorBlurLayout, foldMirrorBlurStacks, MIRROR_FILL_LIMITS } from '../../lib/editor/mirror-blur-layout';
import { mainFootageTrack, onMainFootageTrack, removeShots, rippleAfter, shotAt, shotMembers, swapShots } from '../../lib/editor/shot-edits';
import { SPEAKER_ANALYSIS_VERSION, summarizeSpeakerFraming, type SpeakerAnalysis } from '../../lib/media-analysis/clipping';
import {configureSmoothZoomPatch,rememberZoomTargets,type ZoomTargetEvidence} from '../../lib/ai/zoom-targets';
import {configureCameraMotionPatch} from '../../lib/ai/camera-targets';
import {textGradientPatch} from '../../lib/editor/text-gradient';
import {animateObjects} from '../../lib/editor/object-motion';
import {EFFECT_KEYFRAME_CONTROLS,effectKeyframesPatch} from '../../lib/editor/effect-keyframes';
import {MOTION_EASINGS} from '../../lib/editor/motion-path';
import {SPEED_RAMP_PRESET_IDS,presetAnchors,type SpeedRampPreset} from '../../lib/editor/speed-ramp';
import {bakeMaskAnchors} from '../../lib/editor/masks';
import {DEFAULT_BLUR_REGION_STRENGTH,MAX_BLUR_REGIONS,MIN_BLUR_REGION_SIZE,frameRectToSource,normalizeBlurRegion,regionLocalTime,regionSourceTime,sourceRectToFrame} from '../../lib/editor/blur-regions';
import {attachMaskPatch,attachOverlayPatch,pointsToSamples,streamedAttachmentPatch} from '../../lib/editor/tracking-attach';
import {CAMERA_ZOOM_RANGE,SMOOTH_ZOOM_EASINGS} from '../../lib/editor/smooth-zoom-settings';
import { modelTimeline, modelAssetAnalysis, modelAssetAnalysisWindows, OPTIONAL_UNDERSTANDING_NOTE } from "../../lib/ai/editor-context";
import { closeFootageGaps } from "../../lib/editor/close-gaps";
import { footageGaps, healedNote, MIN_CUT_FRAMES, newPictureGaps, pictureGapNote, snapTimelineToFrames, type FootageGap, type FrameGridHeal } from "../../lib/editor/frame-grid";
import { createTool, storeFile } from "@convex-dev/agent";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import type { Doc,Id } from "../_generated/dataModel";
import type { Clip, PixelTrackReference, Timeline } from "../../lib/editor/types";
import { alignCutsToBeats } from "../../lib/editor/beat-cuts";
import { addBeatMarkers } from "../../lib/editor/beat-markers";
import { addTimelineMarker,moveTimelineMarker,removeTimelineMarker, removeTimelineMarkers } from "../../lib/editor/timeline-markers";
import { AUDIO_ROLES, BLEND_MODES, IRIS_SHAPES, MASK_SHAPES, TRANSITION_DIRECTIONS, TRANSITION_PRESETS, WHIP_BLUR_MAX, WHIP_DIRECTIONS, WHIP_FRAMES, WHIP_TRAVEL, WIPE_DIRECTIONS, dimensions, deriveTrackCounts, layerGroup, deriveTracks, maxTrackCount, timelineDuration, trackOf } from "../../lib/editor/types";
import {VISUAL_INPUT_UNITS,VISUAL_TRANSFORM_LIMITS,transformInputPatch,cropInputPatch} from '../../lib/editor/visual-inputs';
import { addMediaClip, snapTime, addEffectClip, convertSolidColorToVisual, setClipPlaybackRate, setClipSpeedRamp, focusForClip, newLayerOverlaps, patchClip, placeOnFreeLayer, splitClip,trimClip,unlinkClips,linkClips,setClipBlendMode, addTransitionClip } from "../../lib/editor/operations";
import { TimelineGestureRejection } from '../../lib/editor/timeline-edit-errors';
import { APPROVAL_NOTE_LIMIT, approvalRefusal, approvalViolations, approveClip, approvedWork, isApproved, unapproveClip, type ApprovalViolation } from '../../lib/editor/approvals';
import { summarizeTimeline } from "./inspectTimeline";
import { EditSession } from "./editSession";
import { EDITOR_TOOL_DEFINITIONS, assertToolDefinitions } from '../../lib/ai/tool-definitions';
import { ToolSaveReceipts } from './toolSaveReceipts';
import { needsSaveConfirmation, hasSaveEvidence, toolSaveReceipt } from '../../lib/ai/save-confirmation';
import { incidentShape } from './save_incidents';
import { boundRunTab, isMcpRun, READ_ONLY_RUN_PREFIX } from "./run_ids";
import { POSTING_TOOLS, PROJECT_BASE_TOOLS } from "../../lib/ai/lanes/base-tools";
import { CAPTION_LIMIT, TITLE_LIMIT } from "../../lib/posting/limits";
import { TIKTOK_VISIBILITIES, YOUTUBE_VISIBILITIES } from "../../lib/posting/visibility";
import { MCP_WORKER_WAIT_MS } from "./mcp_limits";
import type { PacingResult } from "../../lib/media-analysis/pacing";
import type { SoundResult } from "../../lib/media-analysis/sound";
import { placeClip, TIMELINE_ROW } from "./revision_log";
import { READ_TOOL_DESCRIPTIONS, READ_TOOL_INPUTS, readSummary, runRead, type ReadToolName } from "./reference_reads";
import { ZOOM_LIMITS, isZoomPreset, EFFECT_CATALOG,SOLID_COLOR_LIMITS, OFFERED_TIMED_EFFECT_PRESETS,configureTimedEffectPatch, solidColorPatch } from '../../lib/editor/clip-effects';
import { PUNCH_LIMITS } from '../../lib/editor/motion-effect-settings';
import { TEXT_EFFECT_PRESETS, TEXT_ANIMATION_PRESETS,TEXT_ANIMATION_LABELS,textAnimationPatch, textEffectPatch, textTemplatePatch } from '../../lib/editor/text-effects';
import { TEXT_LOOKS,textLookPatch } from '../../lib/editor/text-looks';
import { hasEmoji, TEXT_FONTS } from '../../lib/editor/text-fonts';
import { applyCaptionPreset,applyCaptionStyle,captionTimingSources,patchCaptionStyles,patchTextStyles,updateCaptionTiming,type CaptionNeighbourChange } from '../../lib/editor/caption-editing';
import { CAPTION_MOTION_LIMITS,CAPTION_PRESETS,findCaptionPreset } from '../../lib/editor/caption-presets';
import { captionSpeech, captionsCoverTranscript, sourceCaptions } from '../../lib/editor/transcript-captions';
import { AUDIO_LIMITS,audioSettings,audioSettingsPatch,configureAudio } from '../../lib/editor/audio-settings';
import { STOCK_AUDIO_IDS,isStockAudioKey,stockAudio } from '../../lib/editor/stock-audio';
import { generateSoundEffect, soundEffectInput, type SoundEffectRequest } from '../../lib/audio/sound-effect';
import { mediaConfig, mediaUrl, newProjectMediaKey } from './media_storage';
import { encodeWav, soundWaveform } from '../../lib/audio/wav';
import { SR } from '../../lib/audio/dsp';
import { MUSIC_BED_LIMITS, renderMusicBed } from '../../lib/audio/music-bed';
import { beatGrid, energyCurve, feelOf, momentFit, phaseForMoments, placeStockMusic, rankStockMusic } from '../../lib/audio/music-match';
import { MIXKIT_LICENSE, MIXKIT_REFERER, stockMusicFileName } from '../../lib/editor/stock-music';
import { putMediaObject, storageControl } from './media_storage';
import {configureVisualFade,VISUAL_FADE_MAX_SECONDS} from '../../lib/editor/visual-fades';
import { OFFERED_VISUAL_EFFECT_GROUPS,visualEffectActionPatch } from '../../lib/editor/visual-effect-actions';
import { VISUAL_EFFECT_LIMITS, visualEffectsPatch } from '../../lib/editor/visual-effects';
import { deleteEmptyLayer, removeEmptyLayers,reorderLayer,moveSelectedClips,moveClipTo,resizeSelectedClips } from '../../lib/editor/timeline-controls';
import {copyTimelineClips,pasteTimelineClips} from '../../lib/editor/clipboard';
import { MAX_INSPECTION_QUESTION, validateVideoInspectionInput, videoMatchesOnClip, type VideoInspectionInput } from '../../lib/media-analysis/video-inspection';
import { currentTranscript } from '../../lib/media-analysis/transcript';
import { frameEvidenceOnClip, frameInspectionCoverage, assertConsecutiveInspection, validateFrameInspectionInput, type FrameInspectionInput } from '../../lib/media-analysis/frame-inspection';
import { shotAlignedRange } from '../../lib/media-analysis/shots';
import { playbackRateOf, sourceEndOf, sourceTimeAt, timelineTimeAtSource } from '../../lib/editor/playback-rate';
import { CSS_REACTIVE_TARGETS, MAX_REACTIVE_SAMPLES, REACTIVE_RATE, decodeLevels, encodeLevels, energyLevels, pulseLevels, reactiveAmountRange } from '../../lib/editor/audio-reactive';
import { HSL_BANDS, LUT_LOOKS, MAX_TIMELINE_LUTS, parseCube, type HslAdjust } from '../../lib/editor/color-finish';
import { describeColor, matchCurves, type ColorStats } from '../../lib/editor/color-match';
import { FREEZE_MODES, MAX_FREEZE_SECONDS, MIN_FREEZE_SECONDS, insertFreezeFrame } from '../../lib/editor/freeze-frame';
import { alignSounds, clipsAtCut, joinClips } from '../../lib/editor/join-clips';
import { CLAMP_TOLERANCE, retainSourceRanges, retainedSourceWindows, type RetainedRangeClamp, type RetainedRangeSummary } from '../../lib/editor/retained-ranges';
import { currentSpeechCleanup, keptRanges, snapToSpeech } from '../../lib/speech-cleanup';
import { applySplitEdits, MAX_SPLIT_EDIT_SECONDS, type SplitEditResult, type SpokenWord } from '../../lib/editor/split-edits';
import type { CleanupCut } from '../../lib/speech-cleanup/types';
import { FrameBudget, LOOKS_UNMEASURED, lookBaseline } from '../../lib/ai/eyes';
import { brollRuns, cutKey, moveEdge, readSpot, reelSpots, spotTimes, type Range, type SpotRecord, type SpotsEvidence } from '../../lib/ai/lanes/reel/looks';
import { BEAT_ROLES, beatsToDrop, keptBroll, lineLabel, lineSpeech, linesToRanges, outlineLines, resolveScriptPlan, scriptOutline, type SavedScript } from '../../lib/ai/lanes/reel/script';
import { AUDIO_ACTIVITY_VERSION, AUDIO_QUIET_EDGE_PAD, refineAudioRangeEdges, refineTranscriptWithAudioActivity } from '../../lib/media-analysis/audio-activity';
import { TEXT_TEMPLATE_PRESETS } from '../../lib/editor/text-templates';
import { DEFAULT_CAPTION_STYLE, DEFAULT_GRAPHIC_STYLE, resolvedTextAppearance, TEXT_APPEARANCE_LIMITS, TEXT_TYPOGRAPHY_LIMITS } from '../../lib/editor/text-style';
import { BEAT_ANALYSIS_ENGINE } from '../../lib/media-analysis/beat-map';
import { barsForLength, musicStructure, nearestDownbeat } from '../../lib/media-analysis/music-structure';
import { musicEnergy } from '../../lib/media-analysis/sound';
import { runLooksRead } from './reference_reads';
import { cutsGiven } from '../../lib/ai/lanes/clip/check';
import { aspectRatio as aspectRatioValidator } from '../schema';
import type { ActionCtx } from "../_generated/server";

/** An analysis or review step that did not finish: the service it needed did not answer in time or at all. */
export class AnalysisStepError extends Error { readonly failureCode: RunFailureCode = 'unavailable'; }
/** A rendered bed's energy, measured as the worker measures a song, so analyzeMusic keeps its exact beat grid. */
const bedEnergy = (samples: readonly ArrayLike<number>[]) => { const energy = musicEnergy(), interleaved = new Float32Array(samples[0].length * 2); for (let i = 0; i < samples[0].length; i++) { interleaved[2 * i] = samples[0][i]; interleaved[2 * i + 1] = samples[1]?.[i] ?? samples[0][i]; } energy.push(interleaved); return energy.finish(); };
/** Export settings, shared by the in-app and MCP exportVideo tools; startRenderFor checks the plan allows them. */
export const EXPORT_SETTINGS_INPUT = { resolution: z.union([z.literal(720), z.literal(1080), z.literal(2160)]).optional(), fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(), quality: z.enum(['draft', 'standard', 'high']).optional() };
async function reportAnalysisFailure<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) { if (error instanceof AnalysisStepError) return { success: false as const, error: error.message.slice(0, 1000), errorCode: error.failureCode }; throw error; }
}

type EditorToolkitOptions = {
  run: EditorRun;
  project: Doc<'projects'>;
  /** Shared with the caller; analysis and generated sounds update it in place. */
  assets: Doc<'assets'>[];
  /** A run resumed after an interruption: its first edit re-reads the saved timeline. */
  recovering: boolean;
  /** Narrows that rule: false for a continuation of the same run, whose draft and clip ids are its own. Default: recovering. */
  inspectFirst?: boolean;
  initialPlans: EffectPlan[];
  selectedClipIds: string[];
  playhead?: number;
  /** The chat turn a destructive replacement is published to, when there is one. */
  publication?: { threadId: string; promptMessageId: string };
  abortSignal: AbortSignal;
  /** MCP clients review their own work (getFrames); effects need no in-turn plan there. */
  planlessEffects?: boolean;
  /** Set by the server from the task's request (lanes.begin); model and reasoning effort never change it. */
  checkLevel?: CheckLevel;
  /** Changed-frame times still to check, carried between runner steps (stored as pendingFastFrames). */
  pendingFastFrames?: number[];
  segment?:number;
  /** Stable editing-lane task identity; MCP calls otherwise have one run each. */
  taskId?:string;
  draft?:Timeline;
  lane?: LaneId;
  finishRequired?:boolean;
  laneChosen?:boolean;
  capabilities?:string[];
  /** The app's reel request on a raw take: the first speech cut waits for readScript and planScript. MCP flows stay as they were. */
  scriptFirst?:boolean;
  /** Who is editing, for limitation samples: the model id in the app, the client's name over MCP. */
  agent?:string;
};

/** The editor's AI tools bound to one active run: the in-app assistant and MCP share them. */
/** Tool output with labeled images: the text without image data, then each image after its label. */
// Chat history keeps every tool result and the chat re-reads its latest page on each new message, so images
// inline in results were read over and over. Store each image as a file and keep only its URL in the result.
async function imagePart(ctx: unknown, data: string, mediaType: string) {
  if (!ctx || typeof ctx !== 'object' || !('storage' in ctx) || !('runMutation' in ctx)) return { type: 'file' as const, data: { type: 'data' as const, data }, mediaType };
  const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
  const { file } = await storeFile(ctx as ActionCtx, components.agent, new Blob([bytes], { type: mediaType }));
  return { type: 'file' as const, data: { type: 'url' as const, url: new URL(file.url) }, mediaType };
}

async function labeledImages(ctx: unknown, output: unknown) {
  const { images = [], ...rest } = output as { images?: { label: string; data: string; mimeType: string }[] };
  return { type: 'content' as const, value: [{ type: 'text' as const, text: JSON.stringify(rest) }, ...(await Promise.all(images.map(async image => [{ type: 'text' as const, text: image.label }, await imagePart(ctx, image.data, image.mimeType)]))).flat()] };
}


/** Opens the description of both tools that send something outside Revline. */
const POST_RULE = 'Outward-facing and not undoable on TikTok or Instagram. Call only when the user asked to post or schedule in this conversation, for the clips and accounts they named; never on your own initiative and never to approve finished work on their behalf.';
const POST_FLOW = 'It exports the clip itself when needed, with the project’s export settings: never call exportVideo first or ask again about exporting. In the Revline editor it only shows a confirmation card and nothing is exported or sent until the user presses it: end your turn after it. Over MCP, without confirm it returns a preview and creates nothing; pass confirm: true only after the user agreed to that preview. getPost reports exporting, posting, published or failed.';
const POST_INPUT = {
  timelineIds: z.array(z.string().min(1)).min(1).max(10).optional().describe('The clips to post: timeline tab IDs from listTimelines, one post per clip per account. Omit for the current timeline.'),
  accounts: z.array(z.object({
    accountId: z.string().min(1).describe('From listConnectedAccounts.'),
    caption: z.string().max(CAPTION_LIMIT).optional().describe('This account’s own caption, when it differs from the shared one.'),
    title: z.string().max(TITLE_LIMIT).optional().describe('This account’s own title (YouTube).'),
    visibility: z.enum([...YOUTUBE_VISIBILITIES, ...TIKTOK_VISIBILITIES]).optional().describe('Who can view the post. YouTube: always public; omit it (unlisted and private are refused). TikTok: required, PUBLIC_TO_EVERYONE or SELF_ONLY (friends-only and followers-only are refused); the user chooses, there is no default. Instagram: none.'),
    tiktok: z.object({ allowComment: z.boolean().optional(), allowDuet: z.boolean().optional(), allowStitch: z.boolean().optional(), yourBrand: z.boolean().optional().describe('The video promotes the user’s own business.'), brandedContent: z.boolean().optional().describe('A paid partnership. Not with SELF_ONLY.') }).strict().optional().describe('TikTok only. Each is off unless the user asks for it.'),
  }).strict()).min(1).max(20).optional().describe('The connected accounts to post to. With groupId: only accounts that need their own caption or settings (TikTok visibility), or extra accounts beyond the group.'),
  groupId: z.string().min(1).optional().describe('An account group from listConnectedAccounts (its groupId, or its name as the user said it): posts to every account in it. Accounts in it that need reconnecting are skipped and the rest still post. Use the default group when the user asks to post without naming accounts.'),
  caption: z.string().max(CAPTION_LIMIT).describe(`The caption every account uses unless it has its own, up to ${CAPTION_LIMIT} characters (YouTube: the description).`),
  title: z.string().max(TITLE_LIMIT).optional().describe(`Title for YouTube, up to ${TITLE_LIMIT} characters. Without one, the caption’s first line.`),
  confirm: z.boolean().optional().describe('MCP clients only: true sends the posts, after the user agreed to the preview this call returns without it. The Revline editor ignores it and shows a confirmation card.'),
  idempotencyKey: z.string().min(8).max(200).optional().describe('MCP clients only: any unique string for this one request. A retried call with the same key returns the same posts instead of posting twice. Without one, an identical request made the same day counts as a retry.'),
};

/** Shown with approved work in inspectTimeline and inspectClip. */
const APPROVED_RULE = 'Approved clips are signed off by the user. Every editing tool refuses to change them. Edit around them; change one only when the user names it, by passing overrideApproved: true with overrideReason quoting the user. Say in the reply that approved work was changed.';
/** Tools that never change clips, so they take no approved-work override. */
// What a small model still owes after the cut reads clean; it tends to stop at the first thing that works.
const REST_OF_EDIT = 'Now do the rest of the request in order: the opening clip if it names one, then every image, b-roll and overlay it names at the timeline times of their words (find the phrase in the prose above), then finish. The edit is not done while something the request names is missing.';
/** Tools a task closed by failed finish checks still answers: its final result, and the agent's own reports. */
/** What retiming a caption did beside it, for the tool result: an edge stopped at a neighbour, neighbours trimmed or removed. */
function captionTimingReport(retimed: { neighbours: CaptionNeighbourChange[]; snapped?: { start?: number; end?: number } } | undefined) {
  if (!retimed) return {};
  const { neighbours, snapped } = retimed;
  return { ...(snapped ? { snapped, snapNote: `Stopped this caption at its neighbour instead of overlapping it by under a frame: ${[snapped.start !== undefined ? `start ${snapped.start} s` : '', snapped.end !== undefined ? `end ${snapped.end} s` : ''].filter(Boolean).join(', ')}.` } : {}),
    ...(neighbours.length ? { neighbours, neighbourNote: `Made room on the caption track: ${neighbours.map(item => item.action === 'removed' ? `removed ${JSON.stringify(item.text)} (${item.reason})` : `trimmed ${JSON.stringify(item.text)} to ${item.to!.start}–${item.to!.end} s`).join('; ')}.` } : {}) };
}
/** What a cut kept of ranges that spilled past the clip's retained source, for the tool result. */
function clampReport(clamped: readonly RetainedRangeClamp[]) {
  if (!clamped.length) return {};
  const beyond = clamped.filter(item => item.beyondTolerance);
  return { clampedRanges: clamped, clampNote: `Clamped ${clamped.length} range${clamped.length === 1 ? '' : 's'} to the clip's retained source: footage an earlier cut removed, or outside the clip, was not kept. applied lists what was kept.${beyond.length ? ` Range${beyond.length === 1 ? '' : 's'} ${beyond.map(item => item.range).join(', ')} reached more than ${CLAMP_TOLERANCE * 1000} ms past the retained source; footage there stays off the timeline (restoreClip brings it back if it was wanted).` : ''}` };
}
const EXHAUSTED_CALLABLE = new Set(['finish', 'reportLimitation', 'reportIssue']);
const APPROVAL_FREE_TOOLS = new Set(['readScript', 'planScript', 'findHighlights', 'planClips', 'checkClip', 'finishClipping', 'listTimelines', 'createTimeline', 'openTimeline', 'importVideoLink', 'getMediaTask', 'exportVideo', 'listExports', 'getExport', 'cancelExport', 'planEffects', 'previewRender', 'inspectTimeline', 'inspectClip', 'recordFix', 'analyzeMedia', 'detectFacecam', 'inspectVideo', 'inspectFrames', 'inspectAssetAnalysis', 'markMusicBeats', 'analyzeMusic', 'addMarker', 'moveMarker', 'removeMarker', 'removeMarkers', 'remember', 'recallMemory', 'forget', 'getFrames', 'askUser', 'readFrames', 'readSkill', 'analyzeColor', 'trackPoints', 'getTrack', 'addLayer', 'approveClip', 'unapproveClip', 'getSound', 'checkSound', 'readBrief', 'updateBrief', ...POSTING_TOOLS]);

/** A getSound or checkSound result as the agent reads it: lists short enough to scan, one line per second of levels. */
function soundReport(result: SoundResult, check: boolean) {
  const s = (time: number) => `${Math.round(time * 1000) / 1000}s`, onsets = result.onsets.slice(0, 80), words = result.words.slice(0, 200);
  const levels = Array.from({ length: Math.ceil(result.levels.length / 10) }, (_, second) => `${Math.round((result.start + second) * 10) / 10}s: ${result.levels.slice(second * 10, second * 10 + 10).join(' ')} (peak ${Math.max(...result.peaks.slice(second * 10, second * 10 + 10))})`);
  const report = {
    range: `${result.start}-${result.end}s`,
    loudness: `${result.loudness.integrated ?? 'silent'} LUFS integrated, peak ${result.loudness.peak} dBFS`,
    sounds: result.events.map(event => `${event.name} (${event.kind}, clip ${event.clipId}) ${s(event.start)}-${s(event.end)} gain ${event.gain}`),
    onsets: onsets.map(onset => `${s(onset.time)} ${onset.level} dB ${onset.sources.join(' + ') || 'unknown'}`), ...(result.onsets.length > onsets.length ? { moreOnsets: result.onsets.length - onsets.length } : {}),
    levels: { note: 'Momentary loudness in LUFS each 0.1 s, then the loudest sample peak in dBFS that second.', seconds: levels },
    ...(result.silences.length ? { silences: result.silences.map(item => `${s(item.start)}-${s(item.end)}`) } : {}),
    ...(words.length ? { words: words.map(word => `${word.text} ${s(word.start)}-${s(word.end)}`).join(', '), ...(result.words.length > words.length ? { moreWords: result.words.length - words.length } : {}) } : {}),
  };
  if (!check || !result.check) return report;
  const flags = result.check.flags.slice(0, 40);
  return { ...report,
    visualHits: result.check.visualHits.map(hit => `${s(hit.time)} ${Math.round(hit.size * 100)}%`).join(', '),
    soundEffectOnsets: result.check.effectOnsets.map(onset => `${s(onset.time)} ${onset.name}`).join(', '),
    flags: flags.map(flag => ({ at: `${flag.start}-${flag.end}s`, kind: flag.kind, reason: flag.reason })), ...(result.check.flags.length > flags.length ? { moreFlags: result.check.flags.length - flags.length } : {}),
    next: result.check.flags.length ? 'Fix the flagged moments (move each sound effect onto its visual hit, remove extra ones, add missing ones, keep them off spoken words, lower what clips), then run checkSound on that range again. A flag you keep on purpose needs a reason you can name.' : 'Every sound effect lands on its picture change in this range.' };
}

export function createEditorToolkit(ctx: ActionCtx, options: EditorToolkitOptions) {
  const { run, project, assets, recovering, abortSignal } = options;
  // Only a run picked up after a crash must re-read before it edits: a write may or may not have landed. A continuation
  // of the same run works on its own draft, so its clip ids are current and no re-read is needed.
  const inspectFirst = options.inspectFirst ?? recovering;
  // The task row is read once per model step and shared by that step's tools (readTask below). Any write through this
  // toolkit can change the row (toolWrites:run updates its frame evidence), so a write drops the shared read.
  let taskReads = new Map<string, Promise<LaneTaskFields | null>>();
  const dropTaskReads = () => { taskReads = new Map(); };
  const dropAround = <T,>(write: () => Promise<T>) => { dropTaskReads(); return write().finally(dropTaskReads); };
  const baseCtx = ctx;
  const runMutation: ActionCtx['runMutation'] = (ref, ...args) => dropAround(() => baseCtx.runMutation(ref, ...args));
  const runAction: ActionCtx['runAction'] = (ref, ...args) => dropAround(() => baseCtx.runAction(ref, ...args));
  const laneCtx: ActionCtx = { ...baseCtx, runMutation, runAction };
  const receipts = new ToolSaveReceipts(run,options.segment);
  ctx = receipts.context(laneCtx);
  let selectedClipIds = options.selectedClipIds;
  let lane:LaneId=options.lane??'edit';
  const taskId=options.taskId;
  let laneChosen=true;
  const capabilities = new Set(options.capabilities ?? []);
  const loadCapability = async (name: string) => {
    if (!capabilityExists(name)) throw new Error(`Unknown capability "${name}". Search with discoverCapabilities first.`);
    if (taskId) await laneCtx.runMutation(internal.lanes.loadCapability, { ...taskScope, name });
    capabilities.add(name);
    return capabilitySummary(name);
  };
  let finishRequired=options.finishRequired??true;
  let requiredPersisted=finishRequired;
  let requiringFinish:Promise<void>|undefined;
  const noteToolIntent=(name:string)=>{if(name==='finish'||EDITOR_TOOL_DEFINITIONS[name as keyof typeof EDITOR_TOOL_DEFINITIONS]?.effect==='timeline')finishRequired=true;};
  let timelineId=boundRunTab(run.runId)??project.activeTimelineId??project.timelineTabs?.[0]?.id??'main';
  const timelineIdForLane=()=>timelineId;
  let finishResult:FinishResult|undefined;
  /** What a finish reply must report: whether this request's edits are saved now, at which revision, and what Undo does. */
  const finishSaveState=()=>editSession.staged?{timelineSaved:false,saveState:'unsaved draft: these edits are not saved yet. They are saved when finish passes. If this request ends or is stopped first, the last valid draft is normally saved as one undoable revision.'}:{timelineSaved:true,savedRevision:editSession.revision,saveState:editSession.savedEdits?'saved: every edit this request made is in the saved timeline':'no edits were saved by this request and no draft is pending',...(editSession.savedEdits?{undo:'This whole request is one undo step: one Undo restores the timeline as it was before this request changed it, unless the user edited by hand in between.'}:{})};
  const taskScope={ownerId:run.ownerId,projectId:run.projectId,taskId:taskId??run.runId};
  /** This task's small fields with the few small evidence entries tool calls and finish read (changed frames, the
   * frame budget, accepted cut-script flags), plus the evidence of the named checks; never the whole evidence list.
   * Shared until the next write or model step. */
  const readTask=(checks:string[]=[]):Promise<LaneTaskFields|null>=>{
    if(!taskId)return Promise.resolve(null);
    const evidenceTools=[...new Set(['fastFrameReview','eyesBudget','readCutScript',...checks])].sort(),key=evidenceTools.join(',');
    let read=taskReads.get(key);
    if(!read){
      const reads=taskReads,pending=laneCtx.runQuery(internal.lanes.taskFields,{...taskScope,evidenceTools}) as Promise<LaneTaskFields|null>;
      read=pending;reads.set(key,pending);
      pending.catch(()=>{if(reads.get(key)===pending)reads.delete(key);});
    }
    return read;
  };
  const ensureBaseline=async()=>{
    if(!taskId)return;
    const task=await readTask();
    if(!task?.baselineTimelineIds.includes(timelineId))await laneCtx.runMutation(internal.lanes.baseline,{...taskScope,baseline:await laneBaseline(timelineId,editSession.timeline,summarizeTimeline(editSession.timeline,assets).gaps)});
  };

  const sourceFrameRates=new Map<string,number>();
  // The lane's recipe decides every check below. The level only steps up to `final` from the request, never by tool.
  const checkLevel: CheckLevel = options.checkLevel ?? 'standard';
  const recipe = () => laneChecks(lane, checkLevel);
  const tracksChanges = () => tracksChangedFrames(recipe());
  const fastReview = new FastFrameReview(options.pendingFastFrames, () => changedFrameLimit(recipe()));
  /** Frames the current finish call drew for its own check; a passed result hands them to the model as its look. */
  const readTool = async (name: ReadToolName, input: object) => {
    const result = await runRead(ctx, run.ownerId, run.projectId, name, input, abortSignal);
    if ('status' in result) {
      const timelineId = boundRunTab(run.runId);
      return { ...result, nextAction: { ...result.nextAction, arguments: { ...result.nextAction.arguments, ...(timelineId ? { timelineId } : {}) } }, images: [] };
    }
    if (name === 'readFrames') {
      const args = input as { assetId: string };
      if(result.fps)sourceFrameRates.set(args.assetId,result.fps);
    }
    const summary = readSummary(name, result);
    return { ...summary, images: result.image ? [{ label: 'Frame sheet', data: result.image, mimeType: 'image/jpeg' }] : [] };
  };
  let inspected = false;
  /** The last inspectTimeline result of this request: a repeat on an unchanged timeline returns a short pointer to it. */
  let lastInspection: string | undefined;
  /** The tool that ran just before the current one, so a repeat is only shortened when the full answer is the previous result. */
  let previousTool: string | undefined;
  const clippingRun={...run,runId:options.taskId??run.runId};
  const clippingUnavailableReason=async()=>{const state=await ctx.runQuery(internal.clipping.completionState,clippingRun);return 'geminiUnavailableReason' in state?state.geminiUnavailableReason:undefined;};
  let clippingActive=false;
  let clippingTimelineId=boundRunTab(run.runId)??project.activeTimelineId??project.timelineTabs?.[0]?.id??'main';
  type ClipQa='framing'|'decode-health'|'loudness';
  // Final clip checks require QA receipts on every accepted tab: selecting the QA makes finishClipping and finish ask for checkClip.
  // clipping.selectChecks clears every receipt whenever the selection changes, so the selection only grows and always covers every tab;
  // a narrower timelineIds scope from checkClip is not applied at this level.
  const selectClipQa=async(requested:readonly ClipQa[]=[])=>{
    const required=recipe().clipQa??[];
    if(!required.length)return;
    const current=await laneCtx.runQuery(internal.lanes.clipQa,{ownerId:run.ownerId,projectId:run.projectId,runId:clippingRun.runId});
    if(!current)return;
    const checks=[...new Set([...current.checks as ClipQa[],...required,...requested])].sort();
    if(current.allTabs&&checks.length===current.checks.length)return;
    await ctx.runMutation(internal.clipping.selectChecks,{...clippingRun,checks});
  };
  let effectPlans:EffectPlan[]=options.initialPlans;
  // Once this environment reports no review service, later reviews answer at once.
  let reviewServiceMissing=false;
  let videoInspectionUnavailable: string | undefined;
  let videoInspectionQueue = Promise.resolve();
  const optionalVideoInspection = <T,>(work: () => Promise<T>) => {
    const unavailable = () => ({ available: false as const, analyzed: false as const, optional: true, code: 'VIDEO_ANALYSIS_UNAVAILABLE', reason: videoInspectionUnavailable!, next: 'Do not retry unavailable video analysis in this run. Spoken moments may use transcript/voice evidence. Stills, audio peaks and scene cuts do not prove visual action: leave those candidates unresolved and report the missing video evidence. Heavy QA and normalization are not automatic. Billing/provider access must be restored before Gemini video inspection can succeed.' });
    // Concurrent candidate windows share the first failure instead of each
    // uploading another video to an unavailable provider.
    const result = videoInspectionQueue.then(async () => {
      videoInspectionUnavailable ??= await ctx.runQuery(internal.assistant.videoUnavailable, run) ?? (await clippingUnavailableReason()) ?? undefined;
      if (videoInspectionUnavailable) return unavailable();
      try { return await work(); }
      catch (error) {
        if (!(error instanceof AnalysisStepError) || abortSignal.aborted) throw error;
        videoInspectionUnavailable = error.message;
        await ctx.runMutation(internal.assistant.recordVideoUnavailable, { ...run, reason: error.message });
        return unavailable();
      }
    });
    videoInspectionQueue = result.then(() => {}, () => {});
    return result;
  };
  const reviewUnavailableResult={reviewed:false,reviewUnavailable:true,note:'Visual review is not available in this environment. Say the result was not visually checked; do not retry.'};
  const visualEvidence=new Map<string,EffectEvidence>();
  const zoomTargets=new Map<string,ZoomTargetEvidence>();
  const planBindings=new Map<string,string>();
  let editingStarted: Promise<null> | undefined;
  const beginEditing = () => editingStarted ??= ctx.runMutation(internal.assistant.beginEditing, run);
  // Which tools each saved edit came from, for the revision history: those running now, or for a staged
  // replacement published at the end, every tool that staged part of it.
  const runningTools = new Map<string, number>(), stagedTools = new Set<string>();
  const editingTools = (publication?: boolean) => {
    const names = publication ? [...stagedTools] : [...runningTools.keys()];
    if (publication) stagedTools.clear();
    return names.length ? { tool: names.join(', ').slice(0, 120) } : {};
  };
  const editSession = new EditSession(project.timeline ?? { clips: [], fps: 60, aspectRatio: project.aspectRatio }, project.revision ?? 0, {
    apply: (timeline, expectedRevision,publication) => receipts.commit(() => ctx.runMutation(internal.assistant.apply, { ...run, timeline, expectedRevision,...(publication?{stagedPublication:true}:{}),...(publication&&options.publication?{publication:options.publication}:{}), ...editingTools(publication) })),
    validate: (timeline, expectedRevision) => ctx.runMutation(internal.assistant.previewDraft, { ...run, timeline, expectedRevision }),
    beforeChange: beginEditing,
  }, abortSignal);
  if(options.draft){const before=editSession.timeline;editSession.restoreDraft(options.draft);receipts.restoredDraft();if(tracksChanges())fastReview.changed(before,options.draft);}
  // Times queued against an earlier, longer draft are moved onto the frames this timeline has.
  fastReview.fit(editSession.timeline);
  // Approved work (lib/editor/approvals.ts) is refused unless the call passes overrideApproved with the user's reason.
  // The override covers the calls running under it; what it let through is reported back on that call.
  const approvalOverride = { active: 0, reason: '', overridden: [] as ApprovalViolation[] };
  // Every assistant and MCP timeline write passes here, so this is where cuts land on the frame grid
  // (lib/editor/frame-grid.ts): edges on frames, shared boundaries rounded once, sub-frame gaps closed.
  const onFrameGrid = (timeline: Timeline, previous?: Timeline) => snapTimelineToFrames(timeline, assetId => assets.find(asset => asset._id === assetId)?.duration, previous);
  /** The saved timeline and project media now, as inspectTimeline reads them. */
  const readSavedTimeline = async () => {
    const current = await ctx.runQuery(internal.assistant.getRun, run);
    assets.splice(0,assets.length,...current.assets.map(asset=>{const previous=assets.find(item=>item._id===asset._id);return previous?.analysis&&previous.analysisId===asset.analysisId&&previous.analysisUpdatedAt===asset.analysisUpdatedAt?{...asset,analysis:previous.analysis}:asset;}));
    return { timeline: current.project.timeline ?? { clips: [], fps: 60, aspectRatio: current.project.aspectRatio }, revision: current.project.revision ?? 0 };
  };
  // A run picked up after an interruption must not edit a timeline it read before the interrupted write landed. The
  // first edit re-reads the saved timeline itself (the same read as inspectTimeline). When it is what this request
  // already saw, the edit goes ahead with no round trip. Only when it moved is the model asked to read it again first:
  // its targets (clip ids, timeline seconds) and every value a tool derived from the old timeline may be stale.
  // A staged draft that no longer matches the saved revision still fails as a conflict.
  let refreshing: Promise<void> | undefined, timelineMoved: Error | undefined;
  const refreshAfterRecovery = () => {
    if (!inspectFirst || inspected) return Promise.resolve();
    if (timelineMoved) return Promise.reject(timelineMoved);
    const read = refreshing ??= (async () => {
      let seen = { revision: editSession.revision, timeline: '' };
      const current = await editSession.inspect(() => { seen = { revision: editSession.revision, timeline: JSON.stringify(editSession.timeline) }; return readSavedTimeline(); });
      if (current.revision !== seen.revision || JSON.stringify(current.timeline) !== seen.timeline) {
        timelineMoved = stepOrderGuard(`The saved timeline changed while this request was interrupted (revision ${seen.revision} → ${current.revision}). Read it with inspectTimeline, then repeat this call against its current clips.`);
        throw timelineMoved;
      }
      inspected = true;
    })();
    read.catch(() => { if (refreshing === read) refreshing = undefined; });
    return read;
  };
  const checkpoint = async (edit: (timeline: Timeline) => Timeline) => {
    let healed: FrameGridHeal[] = [], holes: FootageGap[] = [], emojiText = false, followed: string[] = [];
    await refreshAfterRecovery();
    const result = await editSession.checkpoint(timeline => {
    let edited = edit(timeline);
    // Captions follow their words when footage moved (trim, move, join, closing gaps), so none is fixed one at a time later.
    if (edited.clips.some(clip => (clip.kind === 'video' || clip.kind === 'audio') && !timeline.clips.some(old => old.id === clip.id && old.start === clip.start && old.duration === clip.duration && old.sourceStart === clip.sourceStart)) || timeline.clips.some(old => (old.kind === 'video' || old.kind === 'audio') && !edited.clips.some(clip => clip.id === old.id))) {
      // A follow never trims or removes another caption: only an edge under a frame into a neighbour stops at it.
      const follow = followSpeechCaptions(timeline, edited, assets, (t, clipId, range) => { const retimed = updateCaptionTiming(t, clipId, range); if (retimed.neighbours.length) throw new Error('neighbour'); return retimed.timeline; });
      edited = follow.timeline; followed = follow.followed;
    }
    const grid = onFrameGrid(edited, timeline); healed = grid.healed;
    // The edit that opens a hole says so in its own result, not three finish checks later.
    holes = newPictureGaps(timeline, grid.timeline);
    const next = grid.timeline, collision = newLayerOverlaps(timeline, next)[0];
    emojiText = next.clips.some(clip => hasEmoji(clip.text) && timeline.clips.find(before => before.id === clip.id)?.text !== clip.text);
    // Refuse before the draft changes; the server repeats this check on every assistant write.
    if (collision) throw new TimelineGestureRejection(`Clips ${collision[0].id} and ${collision[1].id} would overlap on the same layer. Move one to another time or layer first.`, 'overlap');
    const touched = approvalViolations(timeline, next);
    if (touched.length && !approvalOverride.active) throw new TimelineGestureRejection(approvalRefusal(touched), 'approved');
    approvalOverride.overridden.push(...touched);
    return next; });
    receipts.checkpoint(result);
    if (result.unchanged) return result;
    const note = healedNote(healed), round = (value: number) => Math.round(value * 1000) / 1000;
    // An older media processor has no emoji font: say so with the edit instead of leaving a "NO GLYPH" box to be found in a frame.
    // Only for an edit that wrote the emoji text, so moves and trims of that caption stay quiet.
    const emoji = emojiText && !await processorCan(ctx, 'render:emoji');
    return { ...result, ...(followed.length ? { captionsFollowed: followed.length, captionNote: `${followed.length} caption${followed.length === 1 ? '' : 's'} moved with ${followed.length === 1 ? 'its' : 'their'} spoken words.` } : {}), ...(emoji ? { emojiNote: 'The emoji is saved and shows in the editor preview, but the media processor on this server cannot draw emoji yet: frames (getFrames) and exports show a "NO GLYPH" box in its place until the processor is updated. Tell the user, or leave the emoji out for now.' } : {}), ...(note ? { frameGrid: note } : {}), ...(holes.length ? { gapsCreated: holes.slice(0, 50).map(gap => ({ start: round(gap.start), end: round(gap.end), seconds: round(gap.end - gap.start), track: gap.track, ...(gap.afterClipId ? { afterClipId: gap.afterClipId } : {}), beforeClipId: gap.beforeClipId })), gapWarning: pictureGapNote(holes) } : {}) };
  };
  const markerCheckpoint = async (edit: (timeline: Timeline) => Timeline) => {
    const result = await checkpoint(edit);
    return { ...result, removed: result.removedMarkerIds.length };
  };
  // What each clip id an edit in this request removed became: the clips of the same source (or, for text and effects,
  // the same kind) that now cover its source range or time. Empty when it was deleted outright.
  const successors = new Map<string, string[]>();
  const recordSuccessors = (before: Timeline, after: Timeline) => {
    const live = new Set(after.clips.map(clip => clip.id)), end = (clip: Clip) => clip.start + clip.duration;
    for (const gone of before.clips) {
      if (live.has(gone.id)) continue;
      const media = !!gone.assetId && (gone.kind === 'video' || gone.kind === 'audio' || gone.kind === 'image');
      successors.set(gone.id, after.clips.filter(clip => clip.kind === gone.kind && (media
        ? clip.assetId === gone.assetId && clip.sourceStart < sourceEndOf(gone) - 1e-6 && sourceEndOf(clip) > gone.sourceStart + 1e-6
        : clip.start < end(gone) - 1e-6 && end(clip) > gone.start + 1e-6)).map(clip => clip.id));
    }
  };
  /** The live clips an id now stands for: itself, the clips it was cut or replaced into, [] when deleted, undefined when unknown. */
  const liveSuccessors = (timeline: Timeline, id: string, depth = 0): string[] | undefined => {
    if (timeline.clips.some(clip => clip.id === id)) return [id];
    const next = successors.get(id);
    if (!next || depth > 20) return next && [];
    return [...new Set(next.flatMap(item => liveSuccessors(timeline, item, depth + 1) ?? []))];
  };
  const span = (timeline: Timeline, id: string) => { const clip = timeline.clips.find(item => item.id === id)!; return `${id} (${clip.kind}, ${Math.round(clip.start * 1000) / 1000}–${Math.round((clip.start + clip.duration) * 1000) / 1000} s)`; };
  /** Rewrite stale clip ids in a tool input: one successor is used (and noted); several, or a deletion, refuse naming only those. */
  const resolveStaleIds = (timeline: Timeline, input: unknown): { input: unknown; notes: string[]; refusal?: string } => {
    const notes: string[] = [];
    let refusal: string | undefined;
    const idKey = (key: string) => /(^|[a-z])(clipId|ClipId)$|^clipIds$|^targetIds$|^(a|b)$/.test(key);
    const swap = (id: string) => {
      if (refusal || timeline.clips.some(clip => clip.id === id) || !successors.has(id)) return id;
      const live = liveSuccessors(timeline, id) ?? [];
      if (live.length === 1) { notes.push(`${id} was cut or replaced earlier in this request; used ${live[0]} instead.`); return live[0]; }
      refusal = live.length ? `Clip ${id} was cut into ${live.length} clips earlier in this request: ${live.map(item => span(timeline, item)).join('; ')}. Nothing was changed. Repeat the call with the one you mean.` : `Clip ${id} was deleted earlier in this request. Nothing was changed. Read the current clips with inspectTimeline.`;
      return id;
    };
    const walk = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') return idKey(key) ? swap(value) : value;
      if (Array.isArray(value)) return value.map(item => walk(item, key));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, walk(item, name)]));
      return value;
    };
    const next = walk(input);
    return { input: next, notes, ...(refusal ? { refusal } : {}) };
  };
  // A stale id gets its successors (or the current clips) back in the refusal, so the next call can name the right one without a re-read.
  const find = (timeline: Timeline, id: string) => { const clip = timeline.clips.find(c => c.id === id); if (!clip) {
    const live = liveSuccessors(timeline, id);
    if (live) throw new Error(live.length ? `Clip ${id} was cut or replaced earlier in this request into ${live.map(item => span(timeline, item)).join('; ')}. Nothing was changed. Repeat the call with ${live.length === 1 ? 'that id' : 'the one you mean'}.` : `Clip ${id} was deleted earlier in this request. Nothing was changed. Read the current clips with inspectTimeline.`);
    const round = (value: number) => Math.round(value * 1000) / 1000, label = (c: Clip) => `${layerGroup(c.kind) === 'audio' ? 'A' : layerGroup(c.kind) === 'effects' ? 'FX' : 'V'}${trackOf(c)}`;
    const listed = [...timeline.clips].sort((a, b) => (a.kind === 'video' || a.kind === 'image' ? 0 : 1) - (b.kind === 'video' || b.kind === 'image' ? 0 : 1) || a.start - b.start).slice(0, 40);
    throw new Error(`Clip not found: ${id} is not on the current timeline (an id changes when its clip is cut, replaced or deleted). Nothing was changed. Clips now, as id kind layer start–end s${timeline.clips.length > listed.length ? ` (first ${listed.length} of ${timeline.clips.length})` : ''}: ${listed.map(c => `${c.id} ${c.kind} ${label(c)} ${round(c.start)}–${round(c.start + c.duration)}`).join('; ') || 'none'}. Repeat the call with one of these ids.`);
  } return clip; };
  const approvedNote = (timeline: Timeline) => { const approved = approvedWork(timeline); return approved.length ? { approved, approvedRule: APPROVED_RULE } : {}; };
  const textColor = z.string().regex(/^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i);
  const appearanceColor=z.string().regex(/^#[\da-f]{6}$/i);
  const textStyleInput=z.object({strokeWidth:z.number().min(TEXT_APPEARANCE_LIMITS.strokeWidth[0]).max(TEXT_APPEARANCE_LIMITS.strokeWidth[1]).optional(),strokeColor:appearanceColor.optional(),shadowBlur:z.number().min(TEXT_APPEARANCE_LIMITS.shadowBlur[0]).max(TEXT_APPEARANCE_LIMITS.shadowBlur[1]).optional(),shadowX:z.number().min(TEXT_APPEARANCE_LIMITS.shadowX[0]).max(TEXT_APPEARANCE_LIMITS.shadowX[1]).optional(),shadowY:z.number().min(TEXT_APPEARANCE_LIMITS.shadowY[0]).max(TEXT_APPEARANCE_LIMITS.shadowY[1]).optional(),shadowColor:appearanceColor.optional(),glowBlur:z.number().min(TEXT_APPEARANCE_LIMITS.glowBlur[0]).max(TEXT_APPEARANCE_LIMITS.glowBlur[1]).optional(),glowColor:appearanceColor.optional(),fontWeight:z.number().int().min(TEXT_TYPOGRAPHY_LIMITS.fontWeight[0]).max(TEXT_TYPOGRAPHY_LIMITS.fontWeight[1]).optional(),italic:z.boolean().optional(),letterSpacing:z.number().min(TEXT_TYPOGRAPHY_LIMITS.letterSpacing[0]).max(TEXT_TYPOGRAPHY_LIMITS.letterSpacing[1]).optional(),lineHeight:z.number().min(TEXT_TYPOGRAPHY_LIMITS.lineHeight[0]).max(TEXT_TYPOGRAPHY_LIMITS.lineHeight[1]).optional(),textAlign:z.enum(['left','center','right']).optional(),paddingX:z.number().min(0).max(200).optional(),paddingY:z.number().min(0).max(200).optional(),borderRadius:z.number().min(0).max(200).optional()});
  const fontFamily=z.enum(TEXT_FONTS.map(font=>font.id));
  const captionPresetInput=z.union([z.number().int().min(1).max(CAPTION_PRESETS.length),z.string().min(1).max(60)]).describe(`Caption preset number 1–${CAPTION_PRESETS.length} or name, e.g. 1 or "Bold Pop".`);
  const resolveCaptionPreset=(value:string|number)=>{const found=findCaptionPreset(value);if(!found)throw new Error(`No caption preset ${JSON.stringify(value)}. Choose a number 1–${CAPTION_PRESETS.length} or a name: ${CAPTION_PRESETS.map(preset=>`${preset.number} ${preset.name}`).join(', ')}.`);return found;};
  const clipIdsInput=z.array(z.string().min(1).max(100)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'});
  // Montage edits name a shot by the time it plays: the footage clip showing at that second.
  const shotTimeInput=z.number().min(0).describe('A timeline second: the video/image shot showing at that time (a cut belongs to the shot that starts there). Mirror-blur copies are never chosen.');
  const shotTrackInput=z.number().int().min(1).max(24).optional().describe('V layer to look on when footage is stacked; default the main footage layer.');
  // Batch audio edits: clipId or clipIds (one saved revision). Every id is checked before any change, naming the bad ones;
  // a linked video resolves to its separate sound, and ids sharing one sound clip count once.
  const batchAudioIdsInput=clipIdsInput.max(100);
  const oneClipTarget=(input:{clipId?:string;clipIds?:string[]})=>(input.clipId!==undefined)!==(input.clipIds!==undefined);
  const audioTargets=(t:Timeline,ids:string[],check:(clip:Clip,target:Clip|undefined)=>void)=>{
    const targets=new Set<string>(),bad:string[]=[];
    for(const id of ids){const clip=t.clips.find(c=>c.id===id);if(!clip){bad.push(`${id} (not found)`);continue}
      const target=clip.kind==='video'&&clip.linkedClipId?t.clips.find(c=>c.id===clip.linkedClipId&&c.linkedClipId===clip.id):clip;
      try{check(clip,target);targets.add(target?.id??clip.id)}catch(error){bad.push(`${id} (${error instanceof Error?error.message:String(error)})`)}}
    if(bad.length)throw new Error(`No audio changed. Fix these clip IDs: ${bad.join('; ')}.`);
    return [...targets];
  };
  // A named easing, or a cubic-bézier [x1,y1,x2,y2] (y may overshoot for anticipation/bounce).
  const motionEasingInput=z.union([z.enum(MOTION_EASINGS),z.tuple([z.number().min(0).max(1),z.number().min(-1).max(2),z.number().min(0).max(1),z.number().min(-1).max(2)])]);
  const objectMotionInput=z.object({clipId:z.string().min(1),replaceMotion:z.boolean().optional(),keyframes:z.array(z.object({time:z.number().min(0),x:z.number().min(-1).max(1),y:z.number().min(-1).max(1),scale:z.number().min(.1).max(5),rotation:z.number().min(-360).max(360),opacity:z.number().min(0).max(1),brightness:z.number().min(0).max(4),easing:motionEasingInput.optional()}).strict()).max(120)}).strict();
  const pulseInputs={
    flash:z.object({strength:z.number().min(0).max(1).optional(),attack:z.number().min(.01).max(.99).optional(),release:z.number().min(.01).max(.99).optional()}).strict().optional(),
    shake:z.object({strength:z.number().min(0).max(1).optional(),speed:z.number().min(.25).max(4).optional(),direction:z.enum(['both','horizontal','vertical']).optional()}).strict().optional(),
    punch:z.object({amount:z.number().min(PUNCH_LIMITS.amount[0]).max(PUNCH_LIMITS.amount[1]).optional(),speed:z.number().min(PUNCH_LIMITS.speed[0]).max(PUNCH_LIMITS.speed[1]).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional(),attack:z.number().min(PUNCH_LIMITS.attack[0]).max(PUNCH_LIMITS.attack[1]).optional(),release:z.number().min(PUNCH_LIMITS.release[0]).max(PUNCH_LIMITS.release[1]).optional()}).strict().optional(),
  };
  const zoomInput=z.object({direction:z.enum(['in','out']).optional(),amount:z.number().min(ZOOM_LIMITS.amount[0]).max(ZOOM_LIMITS.amount[1]).optional(),speed:z.number().min(ZOOM_LIMITS.speed[0]).max(ZOOM_LIMITS.speed[1]).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional()});
  const solidColorInput=z.object({color:z.string().regex(/^#[\da-f]{6}$/i).optional(),width:z.number().min(SOLID_COLOR_LIMITS.width[0]).max(SOLID_COLOR_LIMITS.width[1]).optional(),height:z.number().min(SOLID_COLOR_LIMITS.height[0]).max(SOLID_COLOR_LIMITS.height[1]).optional(),x:z.number().min(0).max(1).optional(),y:z.number().min(0).max(1).optional(),opacity:z.number().min(0).max(1).optional()});
  const textInput = z.object({ text: z.string().min(1).max(2000), track: z.number().int().min(1).max(24).optional(), start: z.number().min(0), duration: z.number().positive(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), animation: z.enum(["none", "fade", "rise"]).optional(),textStyle:textStyleInput.optional() });
  const withAnalysis = async <T,>(assetId: string, mode: "highlights" | "transcribe" | "shots" | "beats" | "track" | "video" | "frames" | "facecam" | "speakers", read: (request: Doc<"analysisRequests">) => Promise<T>, inspection?: { highlightSkipGemini?:string; highlightSourceType?:z.infer<typeof sourceType>; videoRequest?: VideoInspectionInput; frameRequest?: FrameInspectionInput; speakerRequest?:{start:number;end:number} }, waitMs?: number) => {
    // Healthy worker heartbeats extend the durable request, but must not extend
    // an MCP call past its transport budget while it holds the edit lock.
    const waitDeadline = waitMs !== undefined || isMcpRun(run.runId) ? Date.now() + Math.min(waitMs ?? MCP_WORKER_WAIT_MS, MCP_WORKER_WAIT_MS) : Infinity;
    const requestId = await retryAbortedTransaction(() => ctx.runMutation(internal.assistant.requestAnalysis, { ...run, assetId, mode, ...inspection }), abortSignal);
    try {
      while (true) {
        abortSignal.throwIfAborted();
        const request = await ctx.runQuery(internal.assistant.analysisRequest, { ...run, requestId });
        if (request.status === "failed") throw new AnalysisStepError(request.error ?? "Media analysis could not complete");
        if (request.status === "completed") return await read(request);
        if (Math.min(request.expiresAt, waitDeadline) <= Date.now()) throw new AnalysisStepError("Media analysis is taking longer than this edit request allows. Its background job will save results; try the edit again once processing finishes.");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally { await safely('clearAnalysis', () => ctx.runMutation(internal.assistant.clearAnalysis, { ...run, requestId })); }
  };
  const loadAsset=async(assetId:string)=>{const asset=materializeTranscript(await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId}));const index=assets.findIndex(item=>item._id===asset._id);if(index<0)throw new Error('Choose media from this project');assets[index]=asset;return asset;};
  const savedCheckpoint=async(assetId:string,edit:(timeline:Timeline)=>Timeline)=>{await loadAsset(assetId);return checkpoint(edit);};
  // Processed copies (freeze stills, smooth slow motion, upscales) come from the media worker.
  type DeriveInput={clipId:string;assetId:string;op:'freeze'|'slowmo'|'upscale'|'stats'|'parallax'|'pixelTrack';selection?:Pick<PixelTrackRequest,'time'|'seed'>;tracking?:PixelTrackRequest;start:number;end:number;backgroundPrompt?:string;time?:number;times?:number[];factor?:number;target?:number;fps?:number;placeLater:boolean};
  const derive=(input:DeriveInput)=>ctx.runMutation(internal.derivations.startFromRun,{...run,...input});
  const adoptAsset=async(assetId:string)=>{const asset=materializeTranscript(await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId}));const index=assets.findIndex(item=>item._id===asset._id);if(index<0)assets.push(asset);else assets[index]=asset;return asset;};
  // Color measured on the worker from a clip's source frames at timeline moments (default: three across the clip).
  const measureClip=async(clip:Timeline['clips'][number],times?:number[]):Promise<ColorStats[]>=>{
    if((clip.kind!=='video'&&clip.kind!=='image')||!clip.assetId)throw new Error('Measure color on a video or image clip.');
    const end=clip.start+clip.duration-1/editSession.timeline.fps,moments=(times?.length?times:[.15,.5,.85].map(fraction=>clip.start+clip.duration*fraction)).map(time=>Math.min(end,Math.max(clip.start,time)));
    const sourceTimes=clip.kind==='image'?[0]:moments.map(time=>sourceTimeAt(clip,time));
    const started=await derive({clipId:clip.id,assetId:clip.assetId,op:'stats',start:sourceTimes[0],end:sourceTimes[sourceTimes.length-1],times:sourceTimes,placeLater:false});
    const deadline=Date.now()+90_000;
    while(true){
      abortSignal.throwIfAborted();
      const row=await ctx.runQuery(internal.derivations.runStatus,{...run,derivationId:started.derivationId});
      if(row.status==='failed')throw new AnalysisStepError(row.error??'Color measurement failed.');
      if(row.status==='completed'&&row.stats)return row.stats as ColorStats[];
      if(Date.now()>deadline)throw new AnalysisStepError('Color measurement is taking too long. Try again in a minute.');
      await new Promise(resolve=>setTimeout(resolve,700));
    }
  };
  const pixelSeedInput = z.union([trackSeed, z.object({ kind: z.literal('object'), noun: z.string().trim().min(1).max(120) }).strict(), z.object({ kind: z.literal('target'), targetId: z.string().min(1) }).strict()]);
  const resolveSubjectSeed = (seed:z.infer<typeof pixelSeedInput>,assetId:string|undefined,time:number):PixelTrackRequest['seed'] => {
    if(seed.kind!=='target')return seed;
    const target=zoomTargets.get(seed.targetId);
    if(!target||target.assetId!==assetId||Math.abs(target.time-time)>1/(target.sourceFps??30)+1e-6||target.confidence==='low')throw new Error('Use a confident inspectFrames target on this source at the seed time.');
    return {kind:'box',box:target.box};
  };
  const trackInput = z.object({ footageClipId: z.string().min(1), time: z.number().nonnegative(), seed: pixelSeedInput, start: z.number().nonnegative().optional(), end: z.number().positive().optional() }).strict();
  const readPixelTrack = async (trackId: string, footage: Clip): Promise<PixelTrackReference> => {
    const row = await ctx.runQuery(internal.derivations.runStatus, { ...run, derivationId: trackId });
    if (row.sourceAssetId !== footage.assetId) throw new Error('This track belongs to different source footage.');
    if (row.status === 'failed') throw new Error(row.error ?? 'Pixel tracking failed.');
    return ctx.runQuery(internal.pixelTracks.referenceForRun, { ...run, trackId });
  };
  const measurePixelTrack = async (input: z.infer<typeof trackInput>) => {
    await editSession.wait();
    const footage = find(editSession.timeline, input.footageClipId);
    if (footage.kind !== 'video' || !footage.assetId) throw new Error('Choose an uploaded video clip.');
    const asset = await loadAsset(footage.assetId), start = input.start ?? footage.start, end = input.end ?? footage.start + footage.duration;
    if (start < footage.start || end > footage.start + footage.duration + 1e-6 || input.time < start || input.time >= end) throw new Error('Seed time and tracking window must be inside the footage clip, in timeline seconds.');
    let time = sourceTimeAt(footage, input.time);
    let seed: PixelTrackRequest['seed'];
    if (input.seed.kind === 'target') {
      const target = zoomTargets.get(input.seed.targetId);
      if (!target || target.assetId !== asset._id || Math.abs(target.time - time) > 1 / (target.sourceFps ?? 30) + 1e-6 || target.confidence === 'low') throw new Error('Use a confident inspectFrames target on this source at the seed time.');
      seed = { kind: 'box', box: target.box }; time = target.time;
    } else seed = input.seed;
    const tracking = pixelTrackRequest.parse({ start: sourceTimeAt(footage, start), end: sourceTimeAt(footage, end), time, seed });
    const started = await derive({ clipId: footage.id, assetId: asset._id, op: 'pixelTrack', tracking, start: tracking.start, end: tracking.end, placeLater: false });
    return ctx.runQuery(internal.pixelTracks.referenceForRun, { ...run, trackId: started.derivationId });
  };
  const curveInput=z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(2).max(16);
  const awaitDerivation=async(derivationId:Id<'derivations'>,limitMs:number)=>{
    const deadline=Date.now()+limitMs;
    while(true){
      abortSignal.throwIfAborted();
      const row=await ctx.runQuery(internal.derivations.runStatus,{...run,derivationId});
      if(row.status==='failed')throw new AnalysisStepError(row.error??'Media processing failed.');
      if(row.status==='completed'&&row.outputAssetId)return adoptAsset(row.outputAssetId);
      if(Date.now()>deadline)throw new AnalysisStepError('Media processing is taking longer than this edit allows. Try again in a minute.');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  };
  // A media task links to one analysis request. Parallel tool calls for the
  // same source and mode share one request: a second request would relink the
  // task and leave the first waiting until it timed out.
  const sharedAnalyses = new Map<string, ReturnType<typeof analyzeOnce>>();
  const speakerWindows = new Map<string, SpeakerAnalysis>();
  const transcriptRefreshFailures = new Map<string, string>();
  const understandingUnavailable = (assetId: string) => ({ assetId, mode: 'understand', analyzed: false, optional: true, understandingNote: OPTIONAL_UNDERSTANDING_NOTE });
  const analyze = async (assetId: string, mode: "transcribe" | "shots" | "beats" | "track" | "facecam" | "speakers", requireAudioActivity = false, speakerRequest?:{start:number;end:number}) => {
    const key = `${assetId}:${mode}:${JSON.stringify(speakerRequest?{start:Math.round(speakerRequest.start*1000)/1000,end:Math.round(speakerRequest.end*1000)/1000}:null)}`;
    const remembered=mode==='speakers'?speakerWindows.get(key):undefined;
    if(remembered){const asset=await loadAsset(assetId);return {...asset,analysis:{...asset.analysis,speakers:remembered}};}
    const shared = sharedAnalyses.get(key);
    if (shared) {
      const asset = await shared;
      // The shared call may not have needed boundary audio; measure it afterwards.
      return requireAudioActivity && asset.analysis?.audioActivity?.version !== AUDIO_ACTIVITY_VERSION ? analyzeOnce(assetId, mode, true) : asset;
    }
    const pending = analyzeOnce(assetId, mode, requireAudioActivity, false, speakerRequest).then(asset=>{if(mode==='speakers'&&asset.analysis?.speakers)speakerWindows.set(key,asset.analysis.speakers);return asset;}).finally(() => sharedAnalyses.delete(key));
    sharedAnalyses.set(key, pending);
    return pending;
  };
  const analyzeOnce = async (assetId: string, mode: "transcribe" | "shots" | "beats" | "track" | "facecam" | "speakers", requireAudioActivity = false, remeasure = false,speakerRequest?:{start:number;end:number}) => {
    if(!remeasure&&(mode==='facecam'||mode==='speakers')){const saved=await loadAsset(assetId),cached=saved.analysis?.speakers;if(mode==='facecam'?!!saved.analysis?.facecam:cached?.version===SPEAKER_ANALYSIS_VERSION&&cached.start<=(speakerRequest?.start??0)&&cached.end>=(speakerRequest?.end??saved.duration??0))return saved;}
    if (!remeasure && mode === 'shots') { const saved = await loadAsset(assetId); if (saved.analysis?.shots) return saved; }
    if (!remeasure && mode === 'transcribe') {
      const saved = await loadAsset(assetId);
      if (currentTranscript(saved.analysis?.transcript) && (!requireAudioActivity || saved.analysis?.audioActivity?.version === AUDIO_ACTIVITY_VERSION)) return saved;
    }
    const request = () => withAnalysis(assetId, mode, async request => {
      let next=materializeTranscript(await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId}));
      if(mode==='speakers'&&request.speakerInspection)next={...next,analysis:{...next.analysis,speakers:request.speakerInspection}};
      if (!next?.analysis) throw new Error("Media analysis completed without saved results");
      if (mode === 'beats' && next.analysis.beats?.engine !== BEAT_ANALYSIS_ENGINE) throw new Error("Dedicated beat tracking did not return a current beat map. Analyze this audio source again.");
      const index = assets.findIndex(asset => asset._id === next._id); assets[index] = next;
      return next;
    },speakerRequest?{speakerRequest}:undefined);
    let next = await request();
    // An already running pre-upgrade task may finish with transcript only.
    // One local backfill upgrades that evidence without repeating transcription.
    if (requireAudioActivity && next.analysis?.transcript && next.analysis.audioActivity?.version !== AUDIO_ACTIVITY_VERSION) next = await request();
    if (requireAudioActivity && (!next.analysis?.transcript || next.analysis.audioActivity?.version !== AUDIO_ACTIVITY_VERSION)) throw new AnalysisStepError('Audio boundary measurement is unavailable. No unverified speech trims were applied.');
    return next;
  };
  // Speech cuts share one path: the source's cleanup map removes pauses, breaths and fillers between
  // words, and every kept piece snaps to its words' measured sound to the millisecond.
  const speechEvidence = async (clipId: string) => {
    await editSession.wait();
    const clip = find(editSession.timeline, clipId);
    if (clip.kind !== 'video' && clip.kind !== 'audio') throw new Error('Choose a video or audio clip with speech.');
    // Upload preparation stores speech evidence on the video source.
    const pair = clip.kind === 'audio' && clip.linkedClipId ? editSession.timeline.clips.find(member => member.id === clip.linkedClipId && member.linkedClipId === clip.id && member.kind === 'video') : undefined;
    const assetId = pair?.assetId ?? clip.assetId;
    if (!assetId) throw new Error('Choose uploaded speech media.');
    let evidence = await analyze(assetId, 'transcribe', true);
    // A source transcribed before cleanup maps existed is measured once more.
    if (!currentSpeechCleanup(evidence.analysis?.speechCleanup)) evidence = await analyzeOnce(assetId, 'transcribe', true, true).catch(() => evidence);
    const cleanup = currentSpeechCleanup(evidence.analysis?.speechCleanup) && evidence.analysis?.transcript ? evidence.analysis.speechCleanup : undefined;
    const offset = clip.assetId === evidence._id ? 0 : pair ? pair.sourceStart - clip.sourceStart : undefined;
    if (offset === undefined) throw new Error('The speech evidence no longer matches this linked source.');
    return { clip, evidence, cleanup, offset, sourceEnd: clip.sourceStart + clip.duration * playbackRateOf(clip) };
  };
  const applySpeechCut = async (clipId: string, speech: Awaited<ReturnType<typeof speechEvidence>>, chosenRanges: { start: number; end: number }[], kinds: Set<string>, minConfidence: number, preview = false) => {
    const { clip, evidence, offset, sourceEnd } = speech, cleanup = speech.cleanup!;
    // Ranges may reach the adjacent pieces an earlier cut left of this source; only retained footage is kept.
    const windows = retainedSourceWindows(editSession.timeline, clipId), own = { start: clip.sourceStart, end: sourceEnd };
    const chosen = chosenRanges.flatMap(range => (range.start >= own.start && range.end <= own.end || !windows.length ? [own] : windows).map(window => ({ start: Math.max(window.start, range.start), end: Math.min(window.end, range.end) }))).filter(range => range.end > range.start);
    if (!chosen.length) throw new Error('None of the ranges is inside this clip’s retained source.');
    const inside = (cut: { start: number; end: number }) => chosen.some(range => cut.end > range.start && cut.start < range.end);
    // Cuts in this clip's source time, only where the kept ranges are.
    const cuts: CleanupCut[] = cleanup.cuts.filter(cut => kinds.has(cut.kind) && cut.confidence >= minConfidence).map(cut => ({ ...cut, start: cut.start - offset, end: cut.end - offset })).filter(inside);
    const transcript = evidence.analysis!.transcript!, activity = evidence.analysis!.audioActivity;
    // A b-roll shot kept by the script plan is footage, not a pause: no cleanup cut and no snapping inside it.
    const shots = savedScript?.assetId === evidence._id ? (savedScript.broll ?? []).filter(shot => shot.kept) : [];
    const isShot = (range: { start: number; end: number }) => shots.some(shot => Math.min(range.end + offset, shot.end) - Math.max(range.start + offset, shot.start) >= (shot.end - shot.start) * .9 && range.end - range.start <= (shot.end - shot.start) * 1.1 + .1);
    const measuredRanges = chosen.flatMap(range => isShot(range) ? [range] : keptRanges(range.start, range.end, cuts)).map(range => {
      if (isShot(range)) return range;
      const source = { start: range.start + offset, end: range.end + offset };
      const measured = cleanup.edges?.length === transcript.words.length * 2 ? snapToSpeech(source, transcript.words, cleanup.edges) : activity ? refineAudioRangeEdges(source, transcript, activity) : source;
      return { start: Math.max(range.start, measured.start - offset), end: Math.min(range.end, measured.end - offset) };
    });
    // Never leave slivers: a kept piece under 0.1 s (or two frames) that holds no spoken word is a leftover between
    // two removed sounds or after the last word. It is dropped and reported; a piece with a word in it always stays.
    const sliver = Math.max(MIN_CUT_FRAMES / editSession.timeline.fps, .1), spoken = (range: { start: number; end: number }) => transcript.words.some(word => { const middle = (word.start + word.end) / 2 - offset; return middle > range.start && middle < range.end; });
    const droppedSlivers = measuredRanges.filter(range => !isShot(range) && ((range.end - range.start) / playbackRateOf(clip) < 1 / editSession.timeline.fps || (range.end - range.start) / playbackRateOf(clip) < sliver && !spoken(range)));
    const ranges = measuredRanges.filter(range => !droppedSlivers.includes(range));
    const chosenLength = chosen.reduce((total, range) => total + range.end - range.start, 0), keptLength = ranges.reduce((total, range) => total + range.end - range.start, 0);
    const count = (kind: string) => cuts.filter(cut => cut.kind === kind).length;
    // What the user is told: the edit removed these, on top of the ranges that were chosen.
    const speechCleanup = { pauses: count('pause'), breaths: count('breath'), fillers: count('filler'), retakes: count('restart'), removedSeconds: Math.round(Math.max(0, chosenLength - keptLength) * 100) / 100, keptPieces: ranges.length, edges: 'measured word sound, placed on the nearest timeline frame', ...(droppedSlivers.length ? { droppedSlivers: droppedSlivers.map(range => ({ sourceStart: Math.round(range.start * 1000) / 1000, sourceEnd: Math.round(range.end * 1000) / 1000 })), sliverNote: `Dropped ${droppedSlivers.length} leftover piece${droppedSlivers.length === 1 ? '' : 's'} shorter than ${Math.round(sliver * 1000) / 1000} s with no spoken word in ${droppedSlivers.length === 1 ? 'it' : 'them'}.` } : {}) };
    if (preview) return { preview: true, speechCleanup, cuts: cuts.slice(0, 200).map(cut => ({ kind: cut.kind, start: cut.start, end: cut.end, confidence: cut.confidence, detail: cut.detail })), keptRanges: ranges };
    if (!ranges.length) throw new Error('Cleanup would remove everything chosen; raise minConfidence or limit kinds.');
    if (ranges.length > 100) throw new Error(`Cleanup would split this clip into ${ranges.length} pieces; clean a shorter clip, raise minConfidence or limit kinds.`);
    let retainedRanges: RetainedRangeSummary[] = [];
    // Speech edges are measured to the millisecond and each lands on the nearest timeline frame, at most half a
    // frame away: rounding outward instead would add back up to a frame of air per edge.
    // Wordless slivers are already gone; a short piece that holds a word is kept down to one frame.
    const result = await checkpoint(t => { const retained = retainSourceRanges(t, clipId, ranges, undefined, true, 1); retainedRanges = retained.ranges; return retained.timeline; });
    return { ...result, speechCleanup, retainedRanges };
  };
  // The length a set of kept ranges will have once the measured cleanup has run inside them, without editing.
  const scriptSeconds = async (clipId: string, speech: Awaited<ReturnType<typeof speechEvidence>>, ranges: { start: number; end: number }[]) => {
    const rate = playbackRateOf(speech.clip), total = (list: { start: number; end: number }[]) => Math.round(list.reduce((sum, range) => sum + range.end - range.start, 0) / rate * 10) / 10;
    // The measured preview covers this clip only; a plan over several pieces of a cut take is summed as given.
    if (!speech.cleanup || !ranges.length || ranges.some(range => range.start < speech.clip.sourceStart - .01 || range.end > speech.sourceEnd + .01)) return { seconds: total(ranges), measured: false };
    const preview = await applySpeechCut(clipId, speech, ranges, new Set(['pause', 'breath', 'filler']), .6, true) as { keptRanges: { start: number; end: number }[] };
    return { seconds: total(preview.keptRanges), measured: true };
  };
  // Saved transcripts and cleanup maps of the speech on the timeline, read from storage only: nothing is transcribed.
  const loadSavedSpeech = async () => {
    const ids = new Set<string>();
    for (const clip of editSession.timeline.clips) {
      if (clip.kind !== 'video' && clip.kind !== 'audio' || !clip.assetId) continue;
      const asset = assets.find(item => item._id === clip.assetId), source = asset?.analysisKinds?.includes('transcribe') || asset?.analysis?.transcript ? asset : assets.find(item => item.audioAssetId === clip.assetId);
      if (source && !source.analysis?.transcript?.words.length && source.analysisKinds?.includes('transcribe')) ids.add(source._id);
    }
    await Promise.all([...ids].map(id => loadAsset(id).catch(() => undefined)));
  };
  let scriptSaved = false, savedScript: SavedScript | undefined, noScript = false, cutRead = false;
  /** What is left of this clip's source on the timeline, in the transcript's time: one span for a raw take, one per piece after a cut. */
  const retainedSpans = (speech: Awaited<ReturnType<typeof speechEvidence>>) => editSession.timeline.clips.filter(item => item.kind === speech.clip.kind && item.assetId === speech.clip.assetId)
    .map(item => ({ start: item.sourceStart + speech.offset, end: sourceEndOf(item) + speech.offset })).sort((a, b) => a.start - b.start);
  // Frames shown to the model are counted per task, so every tool call of one request shares the lane's budget.
  let framesUsed: number | undefined;
  const frameBudget = async (total: number) => {
    if (framesUsed === undefined) { const task = await readTask(); framesUsed = (task?.evidence.find(item => item.tool === 'eyesBudget')?.output as { used?: number } | undefined)?.used ?? 0; }
    const budget = new FrameBudget(total, framesUsed);
    return { budget, save: async () => { framesUsed = budget.used; if (taskId) await laneCtx.runMutation(internal.lanes.evidence, { ...taskScope, evidence: { tool: 'eyesBudget', timelineId, fingerprint: '', input: {}, output: { used: budget.used } } }); } };
  };
  /** Shots of a talking take with no speaker in frame, from one frame a second and the saved shot cuts. */
  const findBroll = async (asset: (typeof assets)[number], range: Range): Promise<{ shots: Range[]; note?: string; unavailable?: boolean }> => {
    try { return await measureBroll(asset, range); }
    catch (error) {
      if (abortSignal.aborted) throw error;
      // No face measurement is "unknown", never "no b-roll". Scene cuts (measured locally by every processor) stand in:
      // a shot with no words in it is kept as footage. Without scene cuts either, long wordless stretches are kept.
      const reason = error instanceof Error ? error.message : 'faces could not be measured';
      const words = asset.analysis?.transcript?.words ?? [], wordless = (shot: Range) => !words.some(word => { const middle = (word.start + word.end) / 2; return middle > shot.start && middle < shot.end; });
      let detected = asset.analysis?.shots;
      if (!detected) try { detected = (await analyze(asset._id, 'shots')).analysis?.shots; } catch (shotError) { if (abortSignal.aborted) throw shotError; }
      if (detected) {
        const cut = detected.shots.slice(1, -1).map(shot => ({ start: shot.start, end: shot.end })).filter(shot => shot.start >= range.start && shot.end <= range.end && shot.end - shot.start >= .8 && shot.end - shot.start <= 20 && wordless(shot));
        return { shots: cut, unavailable: true, note: `B-roll detection unavailable (${reason}). ${cut.length ? 'Shots between scene cuts with no words in them are kept as footage instead.' : 'Scene cuts show no wordless shot inside the take.'}` };
      }
      const spoken = words.filter(word => word.end > range.start && word.start < range.end).sort((x, y) => x.start - y.start), gaps: Range[] = [];
      spoken.forEach((word, index) => { const next = spoken[index + 1]; if (next && next.start - word.end >= 1.5) gaps.push({ start: Math.round((word.end + .1) * 100) / 100, end: Math.round((next.start - .1) * 100) / 100 }); });
      return { shots: gaps, unavailable: true, note: `B-roll detection unavailable (${reason}) and scene cuts could not be measured. Wordless stretches of 1.5 s or more inside the script are kept in case they are b-roll; look with readFrames to decide which to drop.` };
    }
  };
  const measureBroll = async (asset: (typeof assets)[number], range: Range): Promise<{ shots: Range[]; note?: string }> => {
    const span = range.end - range.start, step = Math.max(1, span / 200), times: number[] = [];
    for (let time = range.start + .4; time < range.end; time += step) times.push(Math.round(time * 100) / 100);
    if (asset.kind !== 'video' || times.length < 3) return { shots: [] };
    let { samples } = await runLooksRead(ctx, run.ownerId, run.projectId, asset._id, times, undefined, abortSignal);
    const absent = samples.filter(sample => sample.face <= 0).length;
    if (!absent) return { shots: [] };
    if (absent > samples.length * .6) return { shots: [], note: 'No speaker is on camera for most of this take, so nothing is treated as b-roll.' };
    const cuts = (asset.analysis?.shots?.shots ?? []).slice(1).map(shot => shot.start);
    // Without saved shot cuts, find each shot's edges at a tenth of a second.
    const ordered = [...samples].sort((a, b) => a.time - b.time), fine: number[] = [];
    ordered.forEach((sample, index) => { const next = ordered[index + 1]; if (next && (sample.face <= 0) !== (next.face <= 0) && !cuts.some(cut => cut > sample.time && cut <= next.time)) for (let time = sample.time + .1; time < next.time - .01; time += .1) fine.push(Math.round(time * 100) / 100); });
    if (fine.length) samples = [...samples, ...(await runLooksRead(ctx, run.ownerId, run.projectId, asset._id, fine.slice(0, 240), undefined, abortSignal)).samples];
    return { shots: brollRuns(samples, cuts) };
  };
  /** A raw take: one clip still holding most of a spoken source. A piece of an already cut take is not gated. */
  const rawTake = (clipId: unknown) => {
    const clip = typeof clipId === 'string' ? editSession.timeline.clips.find(item => item.id === clipId) : undefined;
    if (!clip || clip.kind !== 'video' && clip.kind !== 'audio') return false;
    const duration = assets.find(asset => asset._id === clip.assetId)?.duration;
    return !!duration && duration >= 20 && clip.duration * playbackRateOf(clip) >= duration * .85;
  };
  const transformFields={units:z.enum(VISUAL_INPUT_UNITS).optional(),x:z.number().optional(),y:z.number().optional(),scale:z.number().min(VISUAL_TRANSFORM_LIMITS.scale[0]).max(VISUAL_TRANSFORM_LIMITS.scale[1]).optional(),rotation:z.number().min(-360).max(360).optional(),opacity:z.number().min(0).max(1).optional()};
  // Library and generated sound effects share one A layer above dialogue and music when it is free.
  const isEffectSound = (clip: Timeline['clips'][number]) => clip.kind === 'audio' && assets.some(item => item._id === clip.assetId && (isStockAudioKey(item.r2Key) || item.soundRecipe !== undefined));
  const placeEffectSound = async (assetId: string, duration: number, at: number, gain: number) => {
    let id: string = crypto.randomUUID(), overlapping: { clipId: string; role: string }[] = [];
    const result = await checkpoint(t => {
      const frame = 1 / t.fps, start = Math.round(at * t.fps) / t.fps, audio = t.clips.filter(clip => clip.kind === 'audio');
      const placed = recovering ? t.clips.find(clip => clip.assetId === assetId && Math.abs(clip.start - start) < frame) : undefined;
      if (placed) { id = placed.id; return t; }
      const effects = audio.filter(isEffectSound).map(trackOf), others = audio.filter(clip => !isEffectSound(clip)).map(trackOf);
      const track = Math.min(maxTrackCount('audio'), effects.length ? Math.min(...effects) : Math.max(0, ...others) + 1);
      overlapping = audio.filter(clip => !isEffectSound(clip) && (clip.volume ?? 1) > 0 && clip.start < start + duration && start < clip.start + clip.duration).map(clip => ({ clipId: clip.id, role: audioSettings(clip).role }));
      return patchClip(addMediaClip(t, { _id: assetId, kind: 'audio', duration }, id, start, track), id, { volume: gain });
    });
    return { ...result, clipId: id, gain, overlapsAudio: overlapping };
  };
  // Generate with ElevenLabs, upload to the project's R2 media like an upload, and register an ordinary audio asset holding its request.
  const reserveAudio = async () => { abortSignal.throwIfAborted(); await ctx.runMutation(internal.assistant.reserveAudioRequest, run); abortSignal.throwIfAborted(); };
  const createGeneratedSound = async (request: SoundEffectRequest, name?: string, saveToLibrary?: boolean) => {
    const { samples, rate } = await generateSoundEffect(request, abortSignal, reserveAudio), key = newProjectMediaKey(run.ownerId, run.projectId);
    const size = await putMediaObject(key, encodeWav(samples, rate), 'audio/wav');
    try {
      const asset = await ctx.runMutation(internal.assistant.saveGeneratedSound, { ...run, r2Key: key, fileName: `${(name ?? 'Generated sound').replace(/[\\/:*?"<>|]/g, '')}.wav`, size, duration: samples[0].length / rate, waveform: soundWaveform(samples, rate), recipe: JSON.stringify(request), ...(saveToLibrary ? { saveToLibrary } : {}) });
      assets.push(asset);
      return asset;
    } catch (error) { await storageControl({ action: 'delete', key }).catch(() => {}); throw error; }
  };
  // Choice-card previews (voice samples, rendered stills) live in the project's R2 media without becoming assets; the card reads them through a signed URL.
  const publishPreview = async (bytes: Uint8Array<ArrayBuffer>, contentType: string) => {
    const key = newProjectMediaKey(run.ownerId, run.projectId, 'preview-');
    await putMediaObject(key, bytes, contentType);
    return (await mediaUrl(ctx, { r2Key: key }))!;
  };
  // Render frames of the saved (or this turn's staged) timeline as base64 JPEGs, as export draws them.
  // `sheet` asks for several frames as one small labeled contact sheet (the model's look); without it each frame is its own image.
  const renderFrames = async (times: number[], revision?: number, targetTimelineId?:string, resolution?:720|1080, sheet = false) => {
    await editSession.wait();
    const timelineId = targetTimelineId??boundRunTab(run.runId);
    const snapshotId = await ctx.runMutation(internal.mcp.requestFrames, { ownerId: run.ownerId, projectId: run.projectId, ...(editSession.staged && revision === undefined && (!targetTimelineId||targetTimelineId===timelineIdForLane()) ? { runId: run.runId } : {}), ...(timelineId ? { timelineId } : {}), times, ...(resolution?{resolution}:{}), ...(sheet ? { sheet: true } : {}), ...(revision !== undefined ? { revision } : {}) });
    const deadline = Date.now() + 280_000;
    let started = false;
    while (Date.now() < deadline) {
      if (abortSignal.aborted) { await ctx.runMutation(internal.mcp.discardFrames, { snapshotId }); throw new Error('Stopped.'); }
      // Poll with a query: inside an editing tool every mutation stores a save receipt. Only the discard below writes.
      const state = await ctx.runQuery(internal.mcp.frames, { ownerId: run.ownerId, snapshotId });
      if (state.started) started = true;
      if (state.status === 'failed') { await ctx.runMutation(internal.mcp.discardFrames, { snapshotId }); throw new Error(`Frames could not be rendered: ${state.error ?? 'unknown error'}`); }
      if (state.status === 'completed') { await ctx.runMutation(internal.mcp.discardFrames, { snapshotId }); return { revision: state.revision as number, ...(state.atRevision !== undefined ? { atRevision: state.atRevision as number } : {}), resolution:resolution??720, frames: (await snapshotFrames(state)).map(frame => ({ ...frame, time: Math.round(frame.time * 1000) / 1000 })) }; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await ctx.runMutation(internal.mcp.discardFrames, { snapshotId });
    // Say which wait it was: frames that never started were queued behind other renders, not too many.
    throw new FramesUnavailableError(started ? 'Frames took too long to render. Try fewer times.' : 'These frames never started rendering: the media worker stayed busy with other renders. Try again shortly; the number of times was not the problem.');
  };
  // Several frames as one labeled contact sheet. A media processor from before sheets answers with separate frames, which pass through.
  const renderSheet = async (times: number[], revision?: number, targetTimelineId?: string) => {
    const result = await renderFrames(times, revision, targetTimelineId, undefined, times.length > 1);
    return times.length > 1 && result.frames.length === 1 ? { ...result, sheet: result.frames[0].image, frames: times.map(time => ({ time, image: '' })) } : result;
  };
  // The server clamps a check's end to the timeline's length. A fresh request is clamped the same way here, so a range
  // that runs past the end completes instead of handing back a next step the server can only refuse. A resumed or
  // continued check, or one on an earlier revision, keeps the end it was started with.
  const askedRangeEnd = (input: { end?: number; checkId?: string; sourceCheckId?: string; revision?: number }, duration: number) =>
    input.end === undefined || input.checkId || input.sourceCheckId || input.revision !== undefined ? input.end : Math.min(input.end, duration);
  // Pacing renders the whole range on the media worker and returns measurements only, so it may take minutes.
  const checkPacing = async (input: { start?: number; end?: number; fps?: number; checkId?:string; sourceCheckId?:string; revision?:number }) => {
    await editSession.wait();
    const duration = timelineDuration(editSession.timeline), start = input.start ?? 0, asked = askedRangeEnd(input, duration), end = asked ?? duration, timelineId = boundRunTab(run.runId);
    const sourceSnapshotId = input.sourceCheckId ? await ctx.runQuery(internal.mcp.normalizeSnapshotId,{snapshotId:input.sourceCheckId,ownerId:run.ownerId,projectId:run.projectId,kind:'pacing',...(timelineId?{timelineId}:{})}) : undefined;
    const snapshotId = input.checkId ? await ctx.runQuery(internal.mcp.normalizeSnapshotId,{snapshotId:input.checkId,ownerId:run.ownerId,projectId:run.projectId,kind:'pacing',...(timelineId?{timelineId}:{})}) : await ctx.runMutation(internal.mcp.requestFrames, { ownerId: run.ownerId, projectId: run.projectId, ...(editSession.staged ? { runId: run.runId } : {}), ...(timelineId ? { timelineId } : {}), ...(input.revision!==undefined?{revision:input.revision}:{}), ...(sourceSnapshotId ? { sourceSnapshotId } : {}), times: [], pacing: { start, end:end-start<=9?end:start+8, fps: input.fps ?? 10 } });
    const deadline = Date.now() + 45_000;
    for (let state = await ctx.runQuery(internal.mcp.frames, { ownerId: run.ownerId, snapshotId }); ; state = await ctx.runQuery(internal.mcp.frames, { ownerId: run.ownerId, snapshotId })) {
      const checkedRevision = (state.atRevision ?? state.revision) as number, checkedTimelineId = state.timelineId ?? timelineId;
      const requestedEnd = asked ?? (input.checkId ? state.requestedRange?.end ?? end : end);
      if (abortSignal.aborted) throw new Error('Stopped.');
      if (state.status === 'failed') throw new Error(`Saved pacing check ${snapshotId} at revision ${checkedRevision} could not render the range: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') {
        const result = state.pacing as PacingResult, shown = result.flags.slice(0, 30);
        const next=result.end+1/(input.fps??10);
        return { checkId:snapshotId, ...(checkedTimelineId?{timelineId:checkedTimelineId}:{}), completed:next>=requestedEnd-1/(input.fps??10),...(next<requestedEnd-1/(input.fps??10)?{nextAction:{tool:'checkPacing',arguments:{projectId:run.projectId,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),sourceCheckId:snapshotId,start:result.end,end:requestedEnd,revision:checkedRevision,...(input.fps?{fps:input.fps}:{})}},note:'This chunk is complete. Follow nextAction until completed is true to check the whole requested range.'}:{}), revision: checkedRevision, range: `${result.start}-${result.end}s`, samples: `${result.samples} at ${result.fps} fps`, changePerSecond: result.changePerSecond.map((value, second) => `${Math.round(result.start) + second}s ${value}%`).join(', '), cuts: result.cuts, cameraMoves: result.moves, flags: shown.map(flag => ({ at: `${flag.start}-${flag.end}s`, kind: flag.kind, reason: flag.reason })), ...(result.flags.length > shown.length ? { moreFlags: result.flags.length - shown.length } : {}),
          next: result.flags.length ? 'Fix the flagged moments (longer holds, eased moves, fewer changes per second), then run checkPacing on that range again. A flag you keep on purpose (a deliberate snap or flash) needs a reason you can name.' : 'No pacing problems found in this range.' };
      }
      if (Date.now() > deadline) return {status:'pending',checkId:snapshotId,revision:checkedRevision,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),nextAction:{tool:'checkPacing',arguments:{projectId:run.projectId,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),checkId:snapshotId,end:requestedEnd,revision:checkedRevision,...(input.fps?{fps:input.fps}:{})}},note:'The saved chunk keeps running. Follow nextAction to retrieve it; no new job is started.'};
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };
  // Listening decodes the range's mix on the media worker (and for a check also samples its picture), so it may take minutes.
  const listen = async (input: { start?: number; end?: number; fps?: number; checkId?:string; sourceCheckId?:string; revision?:number }, check: boolean) => {
    await editSession.wait();
    const duration = timelineDuration(editSession.timeline), start = input.start ?? 0, asked = askedRangeEnd(input, duration), end = asked ?? duration, timelineId = boundRunTab(run.runId), name = check ? 'checkSound' : 'getSound';
    const sourceSnapshotId = input.sourceCheckId ? await ctx.runQuery(internal.mcp.normalizeSnapshotId,{snapshotId:input.sourceCheckId,ownerId:run.ownerId,projectId:run.projectId,kind:'sound',...(timelineId?{timelineId}:{}),check}) : undefined;
    const snapshotId = input.checkId ? await ctx.runQuery(internal.mcp.normalizeSnapshotId,{snapshotId:input.checkId,ownerId:run.ownerId,projectId:run.projectId,kind:'sound',...(timelineId?{timelineId}:{}),check}) : await ctx.runMutation(internal.mcp.requestFrames, { ownerId: run.ownerId, projectId: run.projectId, ...(editSession.staged ? { runId: run.runId } : {}), ...(timelineId ? { timelineId } : {}), ...(input.revision!==undefined?{revision:input.revision}:{}), ...(sourceSnapshotId ? { sourceSnapshotId } : {}), times: [], sound: { start, end:end-start<=9?end:start+8, check, ...(input.fps ? { fps: input.fps } : {}) } });
    const deadline = Date.now() + 45_000;
    for (let state = await ctx.runQuery(internal.mcp.frames, { ownerId: run.ownerId, snapshotId }); ; state = await ctx.runQuery(internal.mcp.frames, { ownerId: run.ownerId, snapshotId })) {
      const checkedRevision = (state.atRevision ?? state.revision) as number, checkedTimelineId = state.timelineId ?? timelineId;
      const requestedEnd = asked ?? (input.checkId ? state.requestedRange?.end ?? end : end);
      if (abortSignal.aborted) throw new Error('Stopped.');
      if (state.status === 'failed') throw new Error(`Saved ${name} check ${snapshotId} at revision ${checkedRevision} could not decode the range: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') {
        const result=state.sound as SoundResult;
        return {checkId:snapshotId,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),completed:result.end>=requestedEnd-1e-6,...(result.end<requestedEnd-1e-6?{nextAction:{tool:name,arguments:{projectId:run.projectId,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),sourceCheckId:snapshotId,start:Math.max(start,Math.min(result.end,requestedEnd-.3-1e-6)),end:requestedEnd,revision:checkedRevision,...(input.fps?{fps:input.fps}:{})}},note:'This chunk is complete. Follow nextAction until completed is true to check the whole requested range.'}:{}),revision:checkedRevision,...soundReport(result,check)};
      }
      if (Date.now() > deadline) return {status:'pending',checkId:snapshotId,revision:checkedRevision,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),nextAction:{tool:name,arguments:{projectId:run.projectId,...(checkedTimelineId?{timelineId:checkedTimelineId}:{}),checkId:snapshotId,end:requestedEnd,revision:checkedRevision,...(input.fps?{fps:input.fps}:{})}},note:'The saved chunk keeps running. Follow nextAction to retrieve it; no new job is started.'};
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };
  const trimChangeInput=z.object({clipId:z.string().min(1),duration:z.number().positive(),sourceStart:z.number().min(0).optional()});
  const verifyCurrentTimeline = async () => {
    await editSession.wait();
    // Effect plans gate only lanes that run full checks; a lane switch mid-task cannot strand them behind refused review tools.
    if (effectPlans.length && recipe().fullTools) {
      const state = await ctx.runQuery(internal.compositionReview.completionState, { ...run, timeline: editSession.timeline, expectedRevision: editSession.revision });
      const feedback = completionRepairFeedback([], 'stop', { ...state, revision: editSession.revision });
      if (feedback) throw new Error(feedback);
    }
  };
  const switchTimeline = async (open: (revision: number) => Promise<{ timeline: Timeline; revision: number; timelineId: string }>) => {
    await verifyCurrentTimeline();
    const result = await editSession.switchTimeline(open);
    timelineId=result.timelineId;
    finishResult=undefined;
    if(taskId)await laneCtx.runMutation(internal.lanes.switchLane,{...taskScope,timelineId,lane,reason:'Continuing this task in another timeline'});
    await ensureBaseline();
    if (result.timelineChanged) {
      selectedClipIds = [];
      effectPlans = [];
      stagedTools.clear();
    }
    inspected = true;clippingTimelineId=result.timelineId;
    return { ...result, note: 'Editing tools now act on this timeline. Inspect it before editing. Publish this tab before opening another. Finish clipping directly after building accepted tabs; scoped heavy QA is optional. Never call tab changes in parallel with edits.' };
  };
  /** A song's measured structure, measuring it first when its beat map or energy is missing. */
  const readSong = async (input: { clipId?: string; assetId?: string; lengths?: number[] }) => {
    await editSession.wait();
    let clip = input.clipId ? find(editSession.timeline, input.clipId) : undefined;
    // A video's sound lives on its linked audio clip.
    if (clip?.kind === 'video' && clip.linkedClipId) clip = find(editSession.timeline, clip.linkedClipId);
    if (clip && (clip.kind !== 'audio' || !clip.assetId)) throw new Error('Choose the song\'s audio clip.');
    let asset = await loadAsset(clip?.assetId ?? input.assetId!);
    if (!clip && asset.kind === 'video' && asset.audioAssetId) asset = await loadAsset(asset.audioAssetId);
    if (asset.kind !== 'audio' && asset.kind !== 'video') throw new Error('Choose a song: an audio file or a video with sound.');
    if (asset.analysis?.beats?.engine !== BEAT_ANALYSIS_ENGINE || !asset.analysis.beats.energy) asset = await analyze(asset._id, 'beats');
    const map = asset.analysis?.beats;
    if (!map?.energy) throw new AnalysisStepError('The media worker returned a beat map without music energy; it may be older than this tool. Try again once the worker has updated.');
    // Sung words come from the song's own transcript, or its video's when the song is a video's sound.
    const linked = clip?.linkedClipId ? editSession.timeline.clips.find(item => item.id === clip!.linkedClipId)?.assetId : undefined;
    const words = asset.analysis?.transcript?.words.length ? asset.analysis.transcript.words : linked ? (await loadAsset(linked)).analysis?.transcript?.words ?? [] : [];
    // Target lengths are timeline seconds; the song's bars are source seconds.
    const rate = clip && !clip.speedRamp?.length ? playbackRateOf(clip) : 1;
    return { clip, asset, map, words, structure: musicStructure({ ...map, energy: map.energy }, asset.duration ?? map.energy.loudness.length * map.energy.step, words, input.lengths?.map(length => length * rate)) };
  };
  // postVideo and schedulePost share one path. In the editor the checked request becomes a confirmation card and only
  // the user's press sends it; over MCP, where there is no card, the call previews unless confirm is true.
  // A refusal reads as its reason alone: Convex wraps it in "Uncaught ConvexError: … at handler (…)".
  const postRefusal = (error: unknown) => {
    const data = (error as { data?: unknown })?.data, text = typeof data === 'string' ? data : data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : error instanceof Error ? error.message : String(error);
    return new Error(text.replace(/^(?:\[[^\]]*\]\s*)*(?:Uncaught )?(?:ConvexError|Error): /, '').split('\n    at ')[0].trim());
  };
  const posting = async <T,>(work: () => Promise<T>) => { try { return await work(); } catch (error) { throw postRefusal(error); } };
  const sendPosts = (input: z.infer<z.ZodObject<typeof POST_INPUT>>, scheduledAt: number | undefined) => posting(async () => {
    const overMcp = isMcpRun(run.runId), schedule = scheduledAt !== undefined, owner = { ownerId: run.ownerId };
    if (!input.accounts?.length && !input.groupId) throw new Error('Name the accounts to post to (accounts) or an account group (groupId) from listConnectedAccounts. When the user named neither, use their default group; with no default group, ask them which group or accounts.');
    // A group stands for its accounts that can be posted to now; entries in `accounts` add to it or give one of its accounts its own settings.
    const group = input.groupId ? await ctx.runQuery(internal.assistantPosting.groupTargets, { ...owner, group: input.groupId }) as { groupId: Id<'postingGroups'>; accounts: { accountId: Id<'postingAccounts'>; platform: string }[]; skipped: Id<'postingAccounts'>[] } : null;
    const named = input.accounts ?? [];
    const platforms = await ctx.runQuery(internal.assistantPosting.accountPlatforms, { ...owner, accountIds: named.map(account => account.accountId) }) as { accountId: Id<'postingAccounts'>; platform: string }[];
    const own = named.map((account, index) => ({ ...account, accountId: platforms[index].accountId }));
    const targets = group ? [...group.accounts.map(member => own.find(account => account.accountId === member.accountId) ?? { accountId: member.accountId }), ...own.filter(account => !group.accounts.some(member => member.accountId === account.accountId))] : own;
    // What each TikTok account's post can be given, which the preview and the confirmation card state. In the editor,
    // every connected TikTok account is read, so the card can offer them when the user switches group.
    const listed = overMcp ? [] : (await ctx.runQuery(internal.assistantPosting.accounts, owner) as { accountId: Id<'postingAccounts'>; platform: string; status: string }[]).filter(account => account.platform === 'tiktok' && account.status === 'connected').map(account => account.accountId);
    const targetTikTok = [...platforms, ...(group?.accounts ?? [])].filter(account => account.platform === 'tiktok').map(account => account.accountId);
    const tiktokCreators = await Promise.all([...new Set([...targetTikTok, ...listed])].map(accountId => ctx.runAction(internal.postingActions.tiktokCreatorFor, { ...owner, accountId })));
    const request = {
      projectId: run.projectId, timelineIds: input.timelineIds ?? [timelineId], caption: input.caption, ...(input.title ? { title: input.title } : {}), ...(schedule ? { scheduledAt } : {}), tiktokCreators, targets,
      ...(group ? { groupId: group.groupId, ...(group.skipped.length ? { skippedAccountIds: group.skipped } : {}) } : {}),
    };
    if (!overMcp) {
      // The card posts the saved timeline, so this request's edits are checked and saved first, as before an export.
      await verifyCurrentTimeline();
      await editSession.publish();
    }
    // Every check runs here first, so a refusal is reported before anything is written.
    const preview = await ctx.runQuery(internal.assistantPosting.preview, { ...owner, schedule, ...request });
    if (!overMcp) return ctx.runMutation(internal.assistantPosting.propose, { ...run, schedule, ...request });
    if (!input.confirm) return {
      confirmed: false, preview,
      next: `Nothing was exported or ${schedule ? 'scheduled' : 'posted'}. This is exactly what would be sent. Show it to the user (clips, accounts, captions, visibility, time) and call ${schedule ? 'schedulePost' : 'postVideo'} again with the same arguments and confirm: true only after they agree to it.`,
    };
    const task = await readTask();
    if (!task?.postRequested) throw new Error('Posting needs the user’s own request. confirm: true only counts in a task that was started with the user asking to post, publish or schedule: call startTask with their request in their words (for example "post this clip to my TikTok"), loadCapability posting, then call this again. Never post on your own initiative.');
    return ctx.runMutation(internal.assistantPosting.send, { ...run, schedule, ...(options.agent ? { agentName: options.agent } : {}), ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}), ...request });
  });
  const tools = {
    findHighlights:createTool({metadata:EDITOR_TOOL_DEFINITIONS.findHighlights,
      description:"Clipping discovery, only when Revline must choose the moments (\"find the best moments\", /clip); never for source ranges the user gave, which go straight to tabs and finish. Proposes 15–60 s candidates from the saved transcript and measured scene cuts and audio peaks, and says when those are still running. speechLed:true for dialogue (the default for podcasts and talks). Returns candidates, recommendedCount and a 65/100 quality bar; register them with planClips. Workflow: readSkill clipping page moments.",

      inputSchema:z.object({assetId:z.string(),sourceType:sourceType.optional(),speechLed:z.boolean().optional().describe("True when the requested moments are spoken dialogue, including interview or stream dialogue. Commentary over gaming/action does not make visuals irrelevant."),visualReview:z.boolean().optional().describe('True when this request depends on visual context. Discovery still uses targeted short video windows, never whole-video judging.'),count:z.number().int().min(1).max(10).optional(),delivery:z.enum(['candidates','clips']).default('candidates')}),execute:async(_ctx,input)=>{
        let asset = await loadAsset(input.assetId);
        const transcriptOnly = !input.visualReview && (input.speechLed || input.sourceType === 'podcast' || input.sourceType === 'talk');
        if (transcriptOnly && !asset.analysis?.transcript?.words.length) asset = await analyze(input.assetId, 'transcribe');
        // Visual discovery reads cheap helpers (scene cuts, audio peaks). A fresh upload has
        // none saved yet, so measure them here; Gemini only watches targeted inspectVideo windows.
        const pending: string[] = [];
        let pendingNext = '';
        if (!transcriptOnly && asset.kind === 'video') {
          // A bounded wait in every run type: the worker keeps going and saves results after a timeout.
          let running = false;
          const note = (what: string) => (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/taking longer|too many media jobs/i.test(message)) running = true;
            pending.push(`${what}: ${message}`);
          };
          await Promise.all([
            asset.analysis?.shots ? null : withAnalysis(input.assetId, 'shots', () => loadAsset(input.assetId), undefined, MCP_WORKER_WAIT_MS).catch(note('Scene cuts are not measured yet')),
            readHighlights(asset.analysis?.highlights) ? null : withAnalysis(input.assetId, 'highlights', () => loadAsset(input.assetId), { highlightSkipGemini: HIGHLIGHT_SIGNALS_ONLY, ...(input.sourceType ? { highlightSourceType: input.sourceType } : {}) }, MCP_WORKER_WAIT_MS).catch(note('Audio peaks are not measured yet')),
          ]);
          asset = await loadAsset(input.assetId);
          if (pending.length) pendingNext = running
            ? 'Source analysis is still running in the background and saves its results. Call findHighlights again in about a minute to read the saved scene cuts and audio peaks; meanwhile inspectVideo short SOURCE windows to observe events.'
            : 'Scene cuts or audio peaks could not be measured for this source; calling findHighlights again will not change that. Discover moments with short inspectVideo SOURCE windows instead.';
        }
        clippingActive = input.delivery === 'clips';
        const result = await ctx.runMutation(internal.clipping.begin, { ...clippingRun, assetId: asset._id, delivery: clippingActive,
          transcriptOnly, ...(input.sourceType ? { sourceType: input.sourceType } : {}), ...(input.count ? { count: input.count } : {}) });
        if (!pending.length) return result;
        // Never hand back an empty result that looks like "nothing worth clipping".
        return { ...result, signalsPending: pending, warnings: [...(result.warnings ?? []), ...pending],
          next: `${pendingNext} ${result.next ?? ''}`.trim() };
      }}),
    planClips:createTool({metadata:EDITOR_TOOL_DEFINITIONS.planClips,
      description:"Clipping ledger, only after findHighlights, for moments Revline chose; cuts at source ranges you were given need no plan. found:[{title,start,end,kind,hook,payoff,reactionEnd,score,reason}] registers the COMPLETE candidate set (each call replaces it); quotes must match saved words and times, non-verbal moments leave them empty and need a saved inspectVideo observation. Then record every reviewed top-10 ID as accepted or dropped with a concrete reason. Accepted ones need a unique title, clean SOURCE start/end within 12 s of the suggested boundaries, 15–60 s, and their own populated tab (bind timelineId). Returns server IDs and suggested clean ranges. Montage tabs, dropping a built candidate and shortfallReason: readSkill clipping page moments.",
      inputSchema:z.object({shortfallReason:z.string().trim().min(20).max(500).optional().describe('Concrete quality/context/boundary reason fewer clips than the source-length target qualified. Required for a shortfall without explicit dropped-candidate reasons.'),found:z.array(semanticMoment).min(1).max(30).optional(),accepted:z.array(z.object({candidateId:z.string(),name:z.string().trim().min(1).max(60),start:z.number().nonnegative(),end:z.number().positive(),timelineId:z.string().optional(),criticalRegions:z.array(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),w:z.number().positive().max(1),h:z.number().positive().max(1)})).max(12).optional()})).max(10).optional(),dropped:z.array(z.object({candidateId:z.string(),reason:z.string().min(8).max(500)})).max(80).optional()}),execute:async(_ctx,input)=>{clippingActive=true;if(input.accepted?.length)await editSession.wait();return ctx.runMutation(internal.clipping.review,{...clippingRun,...input,editorRunId:run.runId});}}),
    checkClip:createTool({metadata:EDITOR_TOOL_DEFINITIONS.checkClip,
      description:'OPTIONAL scoped QA only when the user requests it. checks selects framing (one sampled rendered sheet), decode-health (retained source diagnostics), or loudness (existing verified measurement). No normalization is implicitly required. Without checks, only cheap saved-data validation runs. Finish does not require this tool. Reuses unchanged passing AND failing results; inspect findings or fix the affected tab, never rerun an unchanged whole batch. acceptedFindings can acknowledge intentional black/freeze after actual review; corruption cannot be waived.',

      inputSchema:z.object({timelineIds:z.array(z.string()).min(1).max(10).optional(),checks:z.array(z.enum(['framing','decode-health','loudness'])).max(3).optional().describe('Only the checks the user explicitly requested. Omit for cheap data validation.'),acceptedFindings:z.array(z.object({kind:z.enum(['freeze','black']),reason:z.string().min(15).max(500)})).max(8).optional()}),execute:async(_ctx,input)=>{
        clippingActive=true;await editSession.wait();
        if (recipe().clipQa) await selectClipQa(input.checks);
        else if (input.checks) await ctx.runMutation(internal.clipping.selectChecks, { ...clippingRun, checks: input.checks, ...(input.timelineIds ? { timelineIds: input.timelineIds } : {}) });
        await editSession.publish();
        const state: { required: boolean; tabs?: { timelineId: string; checked: boolean }[]; reviewMode?: string } = await ctx.runQuery(internal.clipping.completionState,{...clippingRun,timeline:editSession.timeline,timelineId:clippingTimelineId});
        if ('reviewMode' in state && state.reviewMode === 'transcript') await editSession.publish();
        const checkedIds=new Set<string>(state.tabs?state.tabs.filter((tab:{checked:boolean})=>tab.checked).map((tab:{timelineId:string})=>tab.timelineId):[]);
        const requestedIds:string[]=[...new Set<string>(input.timelineIds??(state.tabs?state.tabs.map((tab:{timelineId:string})=>tab.timelineId):[]))];
        const reusedTimelineIds=requestedIds.filter(id=>checkedIds.has(id)),ids=requestedIds.filter(id=>!checkedIds.has(id));
        if(!ids.length){if(state.tabs?.length)return {results:[],images:[],alreadyChecked:true,reusedTimelineIds,next:'Accepted tabs pass the current saved-data checks and any explicitly requested QA. Call finishClipping; repair any accounting errors it reports.'};throw stepOrderGuard('Build accepted clip tabs before checkClip.');}
        const results:unknown[]=[],images:{label:string;data:string;mimeType:string}[]=[];
        await forEachLimited(ids,2,async(timelineId)=>{
          const prepared=await ctx.runQuery(internal.clipping.prepareCheck,{...clippingRun,timelineId,...(input.acceptedFindings?{acceptedFindings:input.acceptedFindings}:{})});
          if (!prepared.qualityChecks.length) {
            results.push(await ctx.runMutation(internal.clipping.checkTranscript, { ...clippingRun, timelineId }));
            return;
          }
          if (prepared.cachedResult) { results.push({ timelineId, ...prepared.cachedResult, reused: true }); return; }
          const snapshotId=await ctx.runMutation(internal.mcp.requestFrames,{ownerId:run.ownerId,projectId:run.projectId,...(editSession.staged?{runId:run.runId}:{}),timelineId,times:[],clipCheck:prepared.request});
          try {
            while(true){abortSignal.throwIfAborted();const checked=await ctx.runQuery(internal.mcp.frames,{ownerId:run.ownerId,snapshotId});
              if(checked.status==='failed')throw new AnalysisStepError(checked.error??'Clip check failed.');
              if(checked.status==='completed'){if(!checked.clipCheck)throw new Error('Clip check completed without data.');const result=clipCheckResult.parse(JSON.parse(checked.clipCheck));results.push({timelineId,...result});if(checked.frames?.[0])images.push({label:`${timelineId}: sampled framing only`,data:checked.frames[0].image,mimeType:'image/jpeg'});break;}
              await new Promise(resolve=>setTimeout(resolve,1000));
            }
          }finally{await safely('discardFrames',()=>ctx.runMutation(internal.mcp.discardFrames,{snapshotId}));}
        });
        results.sort((a,b)=>ids.indexOf((a as {timelineId:string}).timelineId)-ids.indexOf((b as {timelineId:string}).timelineId));
        const failedTimelineIds=results.filter(result=>!(result as {passed:boolean}).passed).map(result=>(result as {timelineId:string}).timelineId);
        return {results,images,reusedTimelineIds,failedTimelineIds,next:failedTimelineIds.length?'Review the actual failed data or optional QA findings. Do not retry unchanged failures or passing tabs. Fix only affected edits or explicitly scope an intentional black/freeze acknowledgement. Never normalize automatically.':'FinishClipping and finish can now validate the saved data. Unrequested heavy checks and normalization are skipped.'};
      },toModelOutput:(ctx,options)=>labeledImages(ctx,options.output)}),
    finishClipping:createTool({metadata:EDITOR_TOOL_DEFINITIONS.finishClipping,description:'Server-enforced close-out of a findHighlights/planClips batch; a task that cut source ranges it was given skips it and calls finish. Compare accepted candidates against actual created/changed tabs, populated source footage, names, source ranges, duration and cheap saved-data checks inline. Only explicitly requested scoped QA requires receipts; no compulsory checkClip, normalization or media job. Returns trusted found/accepted/tabs counts, drop reasons and an exact finalMessage to report. It fails with zero accepted candidates or zero populated tabs: stop and report that no moment qualified instead of retrying. Fix every error before saying done.',inputSchema:z.object({}),execute:async()=>{
      await editSession.wait();await selectClipQa();
      // Cuts at source ranges the request named have no plan to close out: finish runs their cheap checks.
      const clipTask=await readTask();
      if(clipTask&&cutsGiven(clipTask,await ctx.runQuery(internal.clipping.runStarted,clippingRun)))return {required:false,passed:true,rangeCuts:true,errors:[],next:'No clip plan applies: this task cut source ranges it was given and ran neither findHighlights nor planClips. Call finish now. It checks each new tab’s length (15–60 s) and its source footage from timeline data.'};
      const state=await ctx.runQuery(internal.clipping.completionState,{...clippingRun,timeline:editSession.timeline,timelineId:clippingTimelineId});
      if(!state.passed)throw new Error(`Clipping delivery is incomplete: ${JSON.stringify(state.errors)}`);
      return state;
    }}),
    discoverCapabilities: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.discoverCapabilities, description: 'Find relevant optional workflows or supporting skills by the needed action. Returns a short matching index, never full skill text. Shared edits need no discovery.', inputSchema: z.object({ query: z.string().trim().min(3).max(200) }), execute: async (_ctx, {query}) => ({ matches: discoverCapabilities(query), next: 'Use loadCapability for a supporting workflow or readSkill for a skill. Change the primary style only if the deliverable changes.' }) }),
    loadCapability: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.loadCapability, description: 'Load supporting tools and a small skill index by a discovered workflow or skill name, without changing the primary style, task, clip delivery, finish checks or user decisions. Read only the needed skill pages afterward.', inputSchema: z.object({ name: z.string().trim().min(1).max(80) }), execute: async (_ctx, {name}) => ({ ...await loadCapability(name), primaryWorkflow: lane, next: 'Supporting capability loaded. Read needed skills; preserve the primary deliverable and finish it.' }) }),
    switchLane:createTool({metadata:EDITOR_TOOL_DEFINITIONS.switchLane,description:'Optionally change the primary workflow when the deliverable changes. Shared edits need no style selection. For supporting skills/tools use loadCapability instead, preserving the primary deliverable and finish checks.',inputSchema:z.object({lane:z.enum(LANE_IDS),reason:z.string().trim().min(5).max(300),taskType:z.enum(['edit','question'])}),execute:async(_ctx,input)=>{
      if(!taskId)throw stepOrderGuard('Start a task first with startTask.');
      await laneCtx.runMutation(internal.lanes.switchLane,{...taskScope,timelineId,...input});
      lane=input.lane;laneChosen=true;finishRequired ||= input.taskType==='edit';requiredPersisted=finishRequired;finishResult=undefined;
      return {lane,instructions:laneInstructions(lane),checks:checkInstructions(lane,checkLevel),tools:availableToolNames()};
    }}),
    finish:createTool({metadata:EDITOR_TOOL_DEFINITIONS.finish,description:'Run this lane’s completion checks on the saved timeline data (gaps, overlaps, missing media, lengths, captions). Takes no claimed scores or counts. Call once after the edit, before the final reply. It renders no frames and needs none: the user reviews the result, so do not look at frames to verify an edit. One result lists EVERY problem with exact times and clip ids, and fixes names the single call that repairs each kind (closeGaps with no arguments closes every gap at once): make those calls, then call finish again. Gaps and overlaps shorter than a frame are closed by the check itself and reported in healed. A check that fails the same way three times with nothing fixed ends the request, so report its output honestly.',inputSchema:z.object({}).strict(),execute:async()=>{
      if(!taskId)throw stepOrderGuard('Start a task first with startTask.');
      await editSession.wait();await ensureBaseline();
      // An earlier failed step left the draft guarded. Revalidate the last good draft so a passed check can save it.
      await editSession.confirmRepairs();
      if(lane==='reel'&&editSession.timeline.clips.some(clip=>clip.kind==='caption')){
        const audibleIds=new Set(editSession.timeline.clips.filter(clip=>clip.volume!==0&&(clip.kind==='audio'||clip.kind==='video'&&!clip.audioSeparated)).map(clip=>clip.assetId));
        // Each call starts with metadata rows; saved transcripts live in source analysis.
        await Promise.all(assets.filter(asset=>audibleIds.has(asset._id)||asset.audioAssetId&&audibleIds.has(asset.audioAssetId)).map(asset=>loadAsset(asset._id)));
      }
      if(lane==='reel'){const planned=(await readTask())?.script as SavedScript|undefined;if(planned&&assets.some(asset=>asset._id===planned.assetId))await loadAsset(planned.assetId);}
      if(lane==='clip')await selectClipQa();
      // Rounding artefacts are closed here, inside the check: a gap or overlap shorter than a frame is never a failure.
      let healed:string[]=[];
      // Only a private draft is touched (it joins the draft, under the tool that staged it); a saved timeline is never
      // written by a check, and a gap shorter than a frame there is not a failure either.
      if(editSession.staged)try{let closed:FrameGridHeal[]=[];await editSession.checkpoint(t=>{const grid=onFrameGrid(t);closed=grid.healed;return grid.timeline;});const note=healedNote(closed);if(note)healed=[note];}
      catch(error){if(abortSignal.aborted)throw error;}
      // finish checks timeline data only: no frames are rendered or measured and nothing is handed back to look at.
      // The edit is saved the moment the data checks pass; the user reviews the result.
      const frameTask=recipe().frames==='sample'?await readTask():null;
      const durableFrames=frameTask?readFastFrameTimes(frameTask.evidence,timelineId,await timelineHistoryKey(editSession.timeline)):undefined;
      if(cutRead||(await readTask())?.evidence.some(item=>item.tool==='readCutScript'&&item.timelineId===timelineId))await loadSavedSpeech();
      const check=()=>finishLane(laneCtx,{run,taskId,timelineId,timeline:editSession.timeline,assets,healed,...(durableFrames!==undefined?{fastFrameTimes:fastReview.times()}:{}),clipping:()=>ctx.runQuery(internal.clipping.completionState,{...clippingRun,timeline:editSession.timeline,timelineId}),staged:editSession.staged});
      finishResult=await check();
      // A passed check settles the queue of changed spots.
      if(finishResult.passed)fastReview.restore([]);
      if(finishResult.passed){
        try{
          await editSession.publish();
        }
        catch(error){finishResult=await laneCtx.runMutation(internal.lanes.recordFinish,{...taskScope,result:{...finishResult,passed:false,failures:[`The checked draft could not be saved: ${error instanceof Error?error.message:String(error)}`]}});}
      }
      console.info(`[ai-lane-finish] ${JSON.stringify({projectId:run.projectId,runId:run.runId,...finishResult})}`);
      const saveState=finishSaveState();
      return {...finishResult,...saveState,success:finishResult.passed,next:finishResult.passed?'Checks passed. You may report the saved result.':finishResult.exhausted?exhaustedNext(isMcpRun(run.runId)):`Repair the listed failures${finishResult.fixes?.length?' with the calls in fixes':''} and call finish again. Checking again after a repair is progress; a check that fails the same way with nothing fixed counts toward the stop (${finishResult.attempt} of ${MAX_FINISH_ATTEMPTS} so far), and a task gets at most ${MAX_FINISH_CHECKS} failed checks between passes (${finishResult.checks??finishResult.attempt} so far).`};
    }}),
    reportIssue: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.reportIssue,
      description: 'Report a Revline tool defect: wrong or inconsistent output, unexpected failure, or behavior contrary to its contract. Include a short input summary without user text, media, credentials or tokens, what happened and what you expected. Report once per defect, then continue safely or explain the limitation. Not for ordinary validation errors or unsupported requests.',
      inputSchema: z.object({ toolName: z.string().min(1).max(100), inputSummary: z.string().max(600), happened: z.string().min(1).max(1000), expected: z.string().min(1).max(1000) }),
      execute: async (_ctx, input) => {
        const incidentId = await ctx.runMutation(internal.incidents.reportAgent, { ...run, ...input });
        return incidentId ? { incidentId } : { incidentId: null, saved: false, next: 'The report limit is reached and this report was not saved. Do not retry; continue safely or explain the limitation.' };
      },
    }),
    reportLimitation: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.reportLimitation,
      description: 'Note a product limitation: the tools work as designed but cannot do what the user asked, or you fall back to a workaround that gives a lesser result (no tool for a requested effect, a missing option, a hard limit on duration, tracks or resolution, an unsupported format or font, a check that forbids the requested structure). Call once per distinct limitation, then continue with the best available approach and tell the user plainly. Describe the capability, never the user: no names, quoted text, file names, links or transcript. Not for tool defects (reportIssue), plan or credit limits, things the user did not ask for, or failures a retry fixes.',
      inputSchema: z.object({
        // Nothing here fails the call: a missing or mistyped field falls back and unknown keys are dropped. A note about a limitation is never a failed step.
        request: z.string().catch('').describe('What the user asked for, in one or two general sentences. Longer text is shortened.'),
        limitation: z.string().catch('').describe('What could not be done and why, stated the same way each time: the missing tool or option, the hard limit and its value, the unsupported format or effect, or the check that forbids it. Longer text is shortened.'),
        category: z.enum(LIMITATION_CATEGORIES).catch('other'),
        impact: z.enum(LIMITATION_IMPACTS).catch('degraded').describe('blocked: not delivered. degraded: delivered with a lesser result. slower: delivered in full by a longer route.'),
        tool: z.string().optional().catch(undefined).describe('The nearest tool or capability, as an exact tool name when there is one.'),
        workaround: z.string().optional().catch(undefined).describe('What you did instead, or "none; told the user".'),
        wanted: z.string().optional().catch(undefined).describe('The capability that would have solved it, phrased as a feature.'),
      }),
      execute: async (_ctx, input) => {
        // Over-long text is shortened, never rejected, and a refused or failed note is never a failed step.
        const fit = (value: string | undefined, budget: number) => fitChoiceText(value ?? '', budget).text || undefined;
        const next = 'Continue with the best available approach, and tell the user plainly what was not possible and what you did instead.';
        const limitation = fit(input.limitation, 400);
        // Models write the same tool as addTransition, functions.addTransition or mcp__Revline__addTransition: one spelling keeps one row and a publishable name.
        const named = fit(input.tool, 100), bare = named?.split(/[.:/]|__/).at(-1)?.trim().toLowerCase();
        const tool = [...Object.keys(EDITOR_TOOL_DEFINITIONS), ...PROJECT_BASE_TOOLS].find(name => name.toLowerCase() === bare) ?? named;
        // A run is the chat turn in the app and the task over MCP. An MCP call without a task has a new run id every time, so the project stands in.
        const scopeId = taskId ?? (run.runId.startsWith(READ_ONLY_RUN_PREFIX) ? `mcp-project:${run.projectId}` : run.runId);
        if (!limitation) return { recorded: false, next: `limitation was empty, so nothing was noted. ${next}` };
        try {
          const saved = await ctx.runMutation(internal.incidents.reportLimitation, { ...run, scopeId, request: fit(input.request, 300) ?? 'not stated', limitation, category: input.category, impact: input.impact, tool, workaround: fit(input.workaround, 300), wanted: fit(input.wanted, 300), lane, model: fit(options.agent, 100) });
          return saved.recorded ? { recorded: true, ...(saved.repeat ? { note: 'Already noted in this request; it was not counted again.' } : {}), next } : { recorded: false, next: `${saved.reason === 'run-limit' ? 'This request has noted its limit of limitations' : 'The limitation note limit is reached'}, so this one was not saved. Do not retry. ${next}` };
        } catch (error) {
          console.warn(`[ai-limitation] ${JSON.stringify({ projectId: run.projectId, runId: run.runId, saved: false, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' })}`);
          return { recorded: false, next: `The note could not be saved. Do not retry. ${next}` };
        }
      },
    }),
    listTimelines: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.listTimelines, description: "List this project's timeline tabs, each a separate video sharing the project's sources. Editing tools act on the open tab.", inputSchema: z.object({}), execute: async () => ctx.runQuery(internal.assistant.listRunTimelines, run) }),
    createTimeline: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.createTimeline, description: "Create and open a blank timeline tab or duplicate the open tab. For clipping, use blank, the source aspect unless reframing was requested, and the clip's title. Publishes the current draft first; finish clipping directly after building accepted tabs; scoped heavy QA is optional. Never call alongside edits in parallel.", inputSchema: z.object({ from: z.enum(['blank', 'duplicate']), name: z.string().trim().min(1).max(60).optional(), aspectRatio: z.enum(['landscape', 'vertical', 'square']).optional() }), execute: async (_ctx, input) => switchTimeline(expectedRevision => ctx.runMutation(internal.assistant.createRunTimeline, { ...run, expectedRevision, ...input })) }),
    openTimeline: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.openTimeline, description: "Open an existing timeline tab by id from listTimelines. Publishes the current draft first; finish clipping directly after building accepted tabs; scoped heavy QA is optional. Changes the editor tab the user sees. Never call alongside edits in parallel.", inputSchema: z.object({ timelineId: z.string().min(1) }), execute: async (_ctx, input) => switchTimeline(expectedRevision => ctx.runMutation(internal.assistant.openRunTimeline, { ...run, expectedRevision, ...input })) }),
    importVideoLink: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.importVideoLink, description: "Import a video link into this project's Sources, off the timeline. Supported: YouTube, Twitch VODs (twitch.tv/videos/<id>, also while live) and clips, Kick recordings, X posts, Dailymotion, Streamable, Loom, and direct video file links. Instagram, TikTok, Facebook, Vimeo, Rumble, live channel links and private or signed-in videos cannot be imported: say so and ask for the file. At most 3 hours per import: for a longer video, or only a part, pass start/end in SOURCE seconds padded a few seconds (the file starts at 0 there; a Twitch range over 3 minutes may start up to 2 s early, so take exact times from its transcript). Returns taskId: poll getMediaTask until completed, then inspectTimeline. Reuse existing imports on retries.", inputSchema: z.object({ url: z.string().url(), start: z.number().min(0).optional(), end: z.number().positive().optional() }), execute: async (_ctx, input) => ctx.runMutation(internal.assistant.importRunVideo, { ...run, ...input }) }),
    getMediaTask: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getMediaTask, description: "Wait up to 30 seconds for an import, then return its status and resulting source assetId. Reuse the taskId while pending; wait for completed before analysis, then inspectTimeline to refresh media.", inputSchema: z.object({ taskId: z.string().min(1) }), execute: async (_ctx, { taskId }) => {
      const deadline=Date.now()+30_000;
      for(;;){
        abortSignal.throwIfAborted();
        const state=await ctx.runQuery(internal.assistant.runMediaTask,{...run,taskId});
        if(!['queued','running'].includes(state.status)||Date.now()>=deadline)return state;
        await new Promise(resolve=>setTimeout(resolve,Math.min(1500,deadline-Date.now())));
      }
    } }),
    exportVideo: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.exportVideo, description: "Export a timeline to MP4 when the user asks. In the editor it shows a card and nothing renders until the user presses Export on it; an unchanged timeline is never rendered twice. Leave out resolution, fps and quality to use the user's usual settings (those of their last export); pass one only when this message asks for a different value. timelineId selects a tab from listTimelines; omit for the open tab. Finish all requested edits first.", inputSchema: z.object({ timelineId: z.string().min(1).optional(), ...EXPORT_SETTINGS_INPUT }), execute: async (_ctx, input) => {
      // The card ends the turn, so this request's edits must pass their checks before it is shown.
      if (!isMcpRun(run.runId) && finishRequired && !finishResult?.passed) throw new Error('This request changed the timeline and finish has not passed yet. Call finish; once it passes, call exportVideo.');
      await verifyCurrentTimeline();
      await editSession.publish();
      // Over MCP the task already carries the user's confirmation, so the render starts (convex/mcpActions.ts).
      if (isMcpRun(run.runId)) return ctx.runMutation(internal.assistant.exportRunVideo, { ...run, ...input, resolution: input.resolution ?? 1080, fps: input.fps ?? 30, quality: input.quality ?? 'high' });
      return posting(() => ctx.runMutation(internal.assistant.proposeRunExport, { ...run, ...input }));
    } }),
    // The project's exports, through the same owner- and project-checked functions as the MCP tools (convex/mcp.ts).
    listExports: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.listExports, description: "This project's recent exports, newest first: status, progress, settings and whether each is of the current version (current). Read-only.", inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }).strict(), execute: async (_ctx, { limit }) => {
      const jobs = await ctx.runQuery(internal.mcp.listExports, { ownerId: run.ownerId, projectId: run.projectId, limit: limit ?? 10 }) as { output: unknown }[];
      return jobs.map(({ output: _output, ...job }) => job);
    } }),
    getExport: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getExport, description: "One export's status and progress by jobId. A finished export downloads from its card in the chat or the editor's export list. Read-only.", inputSchema: z.object({ jobId: z.string().min(1) }).strict(), execute: async (_ctx, { jobId }) => {
      const { output: _output, ...job } = await ctx.runQuery(internal.mcp.exportJob, { ownerId: run.ownerId, projectId: run.projectId, jobId }) as { output: unknown };
      return job;
    } }),
    cancelExport: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.cancelExport, description: "Stop a queued or rendering export of this project by jobId, when the user asks or it is stuck. Saved edits and finished exports are untouched.", inputSchema: z.object({ jobId: z.string().min(1) }).strict(), execute: async (_ctx, { jobId }) => ctx.runMutation(internal.mcp.cancelExport, { ownerId: run.ownerId, projectId: run.projectId, jobId }) }),

    // Posting to the user's connected social accounts (convex/assistantPosting.ts). Loaded with the posting capability.
    listConnectedAccounts: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.listConnectedAccounts, description: "The user's connected social accounts (YouTube, TikTok, Instagram): accountId, platform, handle, status and whether one needs reconnecting; and their account groups (named sets of accounts, one possibly their default). Call before postVideo or schedulePost to find the accounts or group the user means. The user connects and reconnects accounts and manages groups on the Accounts page (/accounts); no tool does that.", inputSchema: z.object({}), execute: async () => {
      const accounts = await ctx.runQuery(internal.assistantPosting.accounts, { ownerId: run.ownerId }) as unknown[];
      const groups = await ctx.runQuery(internal.assistantPosting.groups, { ownerId: run.ownerId }) as { name: string; isDefault?: boolean }[];
      const fallback = groups.find(group => group.isDefault);
      return {
        accounts, groups,
        ...(accounts.length ? { next: fallback ? `When the user asks to post without naming accounts, post to their default group ${fallback.name} (groupId). A group they name ("post to ${fallback.name}") is matched by its name.` : groups.length ? 'No group is the default: when the user asks to post without naming accounts, ask which group or accounts, even if an earlier request in this chat used one (unless they say "same as before"). A group they name is matched by its name.' : 'The user has no account groups; post to the accounts they name, and ask when they named none.' } : { next: 'No account is connected. The user connects one on the Accounts page (/accounts); then posting is possible.' }),
      };
    } }),
    postVideo: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.postVideo, description: `${POST_RULE} Post clips (timeline tabs of this project) to the user's connected accounts now: one post per clip per account. ${POST_FLOW}`, inputSchema: z.object(POST_INPUT).strict(), execute: async (_ctx, input) => sendPosts(input, undefined) }),
    schedulePost: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.schedulePost, description: `${POST_RULE} Schedule clips (timeline tabs of this project) to the user's connected accounts at a later time: one post per clip per account. Each clip is exported now and sent at the time; later edits do not change the confirmed version. ${POST_FLOW}`, inputSchema: z.object({ ...POST_INPUT, scheduledAt: z.string().describe('When to post: ISO 8601 with a UTC offset, e.g. 2026-11-14T18:00:00-05:00. In the future, within 90 days.') }).strict(), execute: async (_ctx, { scheduledAt, ...input }) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) || !Number.isFinite(Date.parse(scheduledAt))) throw new Error('scheduledAt must be an ISO 8601 time with a UTC offset, such as 2026-11-14T18:00:00-05:00 or 2026-11-14T23:00:00Z.');
      return sendPosts(input, Date.parse(scheduledAt));
    } }),
    listPosts: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.listPosts, description: "The user's recent posts, newest first, each with a postId: exporting (with progress), scheduled, posting, published (with the platform link and stats once reported) or failed (with the reason). allProjects: true lists posts of every project, otherwise this project's. Read-only.", inputSchema: z.object({ status: z.enum(['exporting', 'scheduled', 'posting', 'published', 'failed']).optional(), allProjects: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }).strict(), execute: async (_ctx, input) => {
      const posts = await ctx.runQuery(internal.assistantPosting.list, { ownerId: run.ownerId, ...(input.allProjects ? {} : { projectId: run.projectId }), ...(input.status ? { status: input.status } : {}), limit: input.limit ?? 20 }) as unknown[];
      return { posts, ...(posts.length ? {} : { note: 'No posts match.' }) };
    } }),
    getPost: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getPost, description: "One post by its postId (from postVideo, schedulePost or listPosts): whether it is exporting (with progress), scheduled, posting, published (with the link and stats) or failed (with the reason). Use it to answer whether something is posted yet. Read-only.", inputSchema: z.object({ postId: z.string().min(1) }).strict(), execute: async (_ctx, { postId }) => ctx.runQuery(internal.assistantPosting.get, { ownerId: run.ownerId, postId }) }),
    cancelScheduledPost: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.cancelScheduledPost, description: "Cancel a post that has not been sent, when the user asks: a scheduled post, or a clip still exporting for a post. A post that already started or was published cannot be cancelled or deleted from Revline.", inputSchema: z.object({ postId: z.string().min(1) }).strict(), execute: async (_ctx, { postId }) => posting(() => ctx.runMutation(internal.assistantPosting.cancel, { ...run, postId })) }),
    reschedulePost: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.reschedulePost, description: "Move a post that has not been sent to another time, when the user asks. The accounts, caption and clip version stay as confirmed.", inputSchema: z.object({ postId: z.string().min(1), scheduledAt: z.string().describe('The new time: ISO 8601 with a UTC offset, e.g. 2026-11-14T18:00:00-05:00. In the future, within 90 days.') }).strict(), execute: async (_ctx, { postId, scheduledAt }) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) || !Number.isFinite(Date.parse(scheduledAt))) throw new Error('scheduledAt must be an ISO 8601 time with a UTC offset, such as 2026-11-14T18:00:00-05:00 or 2026-11-14T23:00:00Z.');
      return posting(() => ctx.runMutation(internal.assistantPosting.reschedule, { ...run, postId, scheduledAt: Date.parse(scheduledAt) }));
    } }),

    planEffects:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.planEffects,description:"Record one to eight expectations for an authorized effect or creative styling edit whose look must be judged (zoom punches, footage or texture effects, text looks): purpose, supported strength, timeline window/peak and anchor, targetClipId for existing footage/text, and this run's inspectVideo evidenceId for observed action. Never for fades, crossfades, opacity, volume, cuts, trims, moves, crops, layouts or split screens: apply those directly. Adds or updates plans by ID, up to eight per run; one timed plan per FX pulse. No timeline edits. Writing expectations: readSkill footage-editing page effect-tools.",inputSchema:z.object({plans:z.array(effectPlanInput).min(1).max(8)}),execute:async(_ctx,{plans})=>{
      // Selecting an edit plan is explicit workflow intent, even while the
      // model corrects a rejected preflight before its first timeline write.
      await beginEditing();
      await editSession.wait();
      validateEffectPlan(plans,editSession.timeline,visualEvidence);
      const merged=mergeEffectPlans(effectPlans,plans);
      const originals=editSession.timeline.clips.filter(clip=>merged.some(plan=>(plan.outputClipId??plan.targetClipId)===clip.id));
      await ctx.runMutation(internal.compositionReview.savePlan,{...run,plans,originals});
      for(const plan of plans)if(!equalTimelineValue(effectPlans.find(previous=>previous.id===plan.id),plan))planBindings.delete(plan.id);
      effectPlans=merged;return {planned:true,planIds:plans.map(plan=>plan.id),totalPlans:effectPlans.length,revision:editSession.revision,saved:false,staged:editSession.staged};
    }}),
    previewRender:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.previewRender,description:"Review one or two planned effects (planIds) on the actual composited timeline against an effect-disabled reference: measured pixel differences, timing and text bounds, and narrow Gemini observations. Every selected expectation must fit one three-second window; otherwise review each planId separately. bindings attach a plan to its output clip. After a failed check make one targeted correction and review once more; two nonpassing judgments stop that expectation: name it as unfinished in the reply and do not claim full completion. Reuse passed checks. No timeline edits. Details: readSkill footage-editing page effect-tools.",inputSchema:z.object({planIds:z.array(z.string()).min(1).max(2),bindings:z.array(z.object({planId:z.string(),clipId:z.string()})).max(2).optional()}),execute:async(_ctx,{planIds,bindings:explicitBindings})=>reportAnalysisFailure(async()=>{
      await editSession.wait();
      if(reviewServiceMissing)return reviewUnavailableResult;
      // Without a recorded plan there is nothing to review; that is guidance, not a failed step.
      const selected=planIds.map(id=>effectPlans.find(plan=>plan.id===id));if(selected.some(plan=>!plan))return {reviewed:false,needsPlan:true,note:`Nothing is planned under that ID, so there is nothing to review. For an effect edit, record it with planEffects first.`};
      if(explicitBindings&&(new Set(explicitBindings.map(binding=>binding.planId)).size!==explicitBindings.length||explicitBindings.some(binding=>!planIds.includes(binding.planId))))throw new Error('Bind each selected review plan at most once.');
      const known=planIds.flatMap(planId=>{const clipId=explicitBindings?.find(binding=>binding.planId===planId)?.clipId??planBindings.get(planId);return clipId?[{planId,clipId}]:[];});
      const bindings=effectReviewBindings(selected as EffectPlan[],editSession.timeline,known);
      let reviewId:Id<'compositionReviews'>|undefined;
      try{
        reviewId=await ctx.runMutation(internal.compositionReview.request,{...run,expectedRevision:editSession.revision,timeline:editSession.timeline,planIds,bindings});
        const deadline=Date.now()+180000;
        while(true){abortSignal.throwIfAborted();const review=await ctx.runQuery(internal.compositionReview.get,{...run,reviewId});
          // An environment without the review service cannot review; report it plainly instead of failing.
          if(review.status==='failed'&&/composition review is not configured|Gemini.*HTTP 402/i.test(review.error??'')){reviewServiceMissing=true;return {...reviewUnavailableResult,reason:review.error};}
          if(review.status==='failed')throw new AnalysisStepError(review.error??'Rendered review failed.');
          if(review.status==='completed'){const current=await ctx.runQuery(internal.assistant.getRunTimeline,run),stale=current.revision!==review.result?.revision;return {reviewed:!stale,stale,currentRevision:current.revision,scope:stale?'The timeline changed during review. Inspect the latest state; this receipt describes the earlier snapshot.':'Sampled composited timeline; no audio judgment',staged:editSession.staged,...review.result};}
          if(Date.now()>deadline)throw new AnalysisStepError('Rendered review exceeded its three-minute limit. Saved edits remain.');
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }finally{if(reviewId)await safely('cancelReview',()=>ctx.runMutation(internal.compositionReview.cancel,{...run,reviewId:reviewId!}));}
    })}),
    duplicateClips:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.duplicateClips,description:"Copy explicitly identified existing clips to requested timeline seconds, or duplicate immediately after the latest selected end when at is omitted. Preserve source ranges, relative timing, appearance, audio settings and linked pairs. A linked video copy returns both new video and audio IDs. For a visual overlay, keep its video and mute its copied audio with setVolume volume:0; unlink first when removing only one member. Copy both neighboring sources together with a selected transition to remap its pair correctly. Uses the same free-layer placement as the editor; never reads the browser clipboard or invents media.",inputSchema:z.object({clipIds:clipIdsInput,at:z.number().min(0).optional()}),execute:async(_ctx,{clipIds,at})=>{
      let newClipIds:string[]=[];
      const saved=await checkpoint(t=>{for(const id of clipIds)find(t,id);const copies=copyTimelineClips(t,clipIds);const result=pasteTimelineClips(t,copies,at??Math.max(...copies.map(c=>c.start+c.duration)));newClipIds=result.ids;return result.timeline});
      return {...saved,newClipIds};
    }}),
    reorderLayer:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.reorderLayer,description:"Move a whole occupied or empty layer within its own V/visual, A/audio or FX/effects group, preserving all clip timing and shifting intervening layer numbers as in the editor. from/to are layer numbers, not clip IDs. Audio never becomes visual/FX; source media and linked timing remain.",inputSchema:z.object({group:z.enum(['visual','audio','effects']),from:z.number().int().min(1).max(24),to:z.number().int().min(1).max(24)}),execute:async(_ctx,{group,from,to})=>checkpoint(t=>reorderLayer(t,group,from,to))}),
    moveClips:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.moveClips,description:"Move an explicitly selected clip group by signed timeline timeDelta and/or layerDelta while retaining relative timing and reciprocal linked audio. Same free-layer collision/boundary behavior as a manual group drag. Preserve all source ranges and other clip controls; zero layerDelta preserves the group's layer positions.",inputSchema:z.object({clipIds:clipIdsInput,timeDelta:z.number().optional(),layerDelta:z.number().int().min(-24).max(24).optional()}).refine(input=>input.timeDelta!==undefined||input.layerDelta!==undefined,{message:'Specify a time or layer delta.'}),execute:async(_ctx,{clipIds,timeDelta,layerDelta})=>checkpoint(t=>{for(const id of clipIds)find(t,id);return moveSelectedClips(t,clipIds,timeDelta??0,layerDelta??0)})}),
    resizeClips:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.resizeClips,description:"Trim or extend one edge of a shot or a selected group by a signed timeline delta in seconds, in ONE saved change, snapped to frames. side right moves the end (positive lengthens); side left moves the start (negative lengthens). clipIds, or at: a timeline second for the shot showing there. Linked audio follows. ripple:true moves later clips on the same layers by the same amount ('make the 2 s shot 2.5 s longer' is one call: {at:2, side:'right', delta:2.5, ripple:true}); music, captions and other layers keep their times. Clamps at source bounds, a one-frame minimum and, without ripple, neighbours. Returns the applied ranges.",inputSchema:z.object({clipIds:clipIdsInput.optional(),at:shotTimeInput.optional(),track:shotTrackInput,side:z.enum(['left','right']),delta:z.number(),ripple:z.boolean().optional()}).refine(input=>(input.clipIds!==undefined)!==(input.at!==undefined),{message:'Choose clipIds or at, never both.'}),execute:async(_ctx,{clipIds,at,track,side,delta,ripple})=>{
      let resized:{clipId:string;start:number;end:number;delta:number}[]=[];
      const saved=await checkpoint(t=>{
        const ids=at!==undefined?[shotAt(t,at,track).id]:clipIds!;
        for(const id of ids)find(t,id);
        const members=[...new Set(ids.flatMap(id=>shotMembers(t,id).map(clip=>clip.id)))];
        const next=resizeSelectedClips(t,assets.map(asset=>({...asset,url:null})),members,side,delta,undefined,ripple??false);
        resized=ids.map(id=>{const before=find(t,id),after=find(next,id);return {clipId:id,start:after.start,end:after.start+after.duration,delta:Math.round((after.duration-before.duration)*1000)/1000};});
        return next;
      });
      return {...saved,resized,rippled:!!ripple};
    }}),
    joinClips:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.joinClips,description:"Join neighbouring pieces of one source on one layer into one clip in ONE saved change: the way to undo a split or rejoin pieces that were split and spaced apart; never delete + resize, retainSourceRanges or restoreClip for this. clipIds (two or more, a sound clip names its picture) or at: a timeline second at the cut or gap between two shots on the main footage layer. The gap between them closes. Source that runs on from one piece to the next becomes one seamless clip; source removed between them stays removed with gap 'keep-cut' (default: the pieces butt together as a cut) or comes back with gap 'restore' (one clip through the removed footage). The first piece's properties win (transform, effects, volume). Each piece's sound (linked, or the unlinked audio of the same take under it) is joined the same way and lands in sync with the picture. Later clips on the layer and their sound ripple by the same time; captions move with the footage beneath them and keep their words. Refuses pieces of different sources, layers or speeds, and pieces with another clip between them, naming which.",inputSchema:z.object({clipIds:clipIdsInput.optional(),at:z.number().min(0).optional().describe('Timeline second of the cut or gap between two shots.'),track:shotTrackInput,gap:z.enum(['keep-cut','restore']).optional()}).refine(input=>(input.clipIds!==undefined)!==(input.at!==undefined),{message:'Name the pieces with clipIds, or the cut between two of them with at: one of the two, not both.'}),execute:async(_ctx,input)=>{
      let joined:ReturnType<typeof joinClips>|undefined,gapsBefore=0;
      const result=await checkpoint(t=>{
        const ids=input.clipIds??clipsAtCut(t,input.at!,input.track);
        gapsBefore=footageGaps(t).length;
        joined=joinClips(t,ids,input.gap??'keep-cut',assetId=>assets.find(asset=>asset._id===assetId)?.audioAssetId);
        return joined.timeline;
      });
      const j=joined!;
      return {...result,clipId:j.clipId,pieces:j.pieces,...(j.joined.length?{joinedInto:{[j.clipId]:j.joined}}:{}),...(j.restoredSeconds?{restoredSeconds:j.restoredSeconds}:{}),rippledBy:j.rippledBy,movedCaptions:j.movedCaptions,remainingGaps:footageGaps(editSession.timeline).length,note:`Joined into ${j.pieces.length===1?`one clip ${j.clipId}`:`${j.pieces.length} pieces butting at ${j.pieces.length-1} kept cut${j.pieces.length===2?'':'s'} (gap 'restore' brings the removed footage back)`}; its sound is in sync with the picture${j.rippledBy?`, and later clips moved ${j.rippledBy<0?'earlier':'later'} by ${Math.abs(j.rippledBy)} s`:''}.${gapsBefore?' Other gaps on the timeline are untouched: closeGaps closes them all in one call.':''}`};
    }}),
    swapClips:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.swapClips,description:"Swap two shots in ONE saved change: 'swap 16 s and 19 s' is swapClips {a:16, b:19}. a and b are clip IDs or timeline seconds (the shot showing at that time). Each slot keeps its start, duration and layer, so cut points and music sync stay; the incoming shot plays its own footage from its source start, moved earlier only when the footage would run out. Linked audio and stacked mirror-blur copies travel with their shot, and a backgroundFill is part of the clip. Refuses shots joined by a transition, speed-ramped shots, and footage shorter than the other slot.",inputSchema:z.object({a:z.union([z.string().min(1).max(100),shotTimeInput]),b:z.union([z.string().min(1).max(100),shotTimeInput]),track:shotTrackInput}).strict(),execute:async(_ctx,input)=>{
      let slots={};
      const saved=await checkpoint(t=>{
        const resolve=(ref:string|number)=>typeof ref==='number'?shotAt(t,ref,input.track).id:find(t,ref).id;
        const result=swapShots(t,assets,resolve(input.a),resolve(input.b));slots={a:result.a,b:result.b};return result.timeline;
      });
      return {...saved,swapped:slots};
    }}),
    setBlendMode:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setBlendMode,description:"Set the requested supported blend mode on exact footage/text clip IDs, preserving all other controls. Apply both sides of an existing transition atomically when changing their common blend; unequal transition blends are refused. Audio and FX clips cannot receive blend modes.",inputSchema:z.object({clipIds:clipIdsInput,blendMode:z.enum(BLEND_MODES)}),execute:async(_ctx,{clipIds,blendMode})=>checkpoint(t=>setClipBlendMode(t,clipIds,blendMode))}),
    undoLatestEdit:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.undoLatestEdit,description:"Undo the latest actually saved edit first, only before this turn has applied or staged any changes. Uses saved history, never a guessed replacement/source extension. Returns undone:false when there is no saved edit. Refreshes the working timeline; subsequent changes can be saved together as a new undo group. Inspect the restored clips before choosing targets. To go back to a known-good version of one clip (or a whole tab) from further back, use listRevisions and restoreClip (or restoreTimeline), not chains of undo: undo steps also take back later edits you may want to keep. Redo, playback and the clipboard live in the browser; no tool can reach them.",inputSchema:z.object({}),execute:async()=>{
      await refreshAfterRecovery();
      let undone=false;
      const snapshot=await editSession.inspect(async()=>{
        if(editSession.savedEdits||editSession.staged)throw new Error('Undo the latest saved edit before making changes in this turn.');
        const result=await ctx.runMutation(internal.assistant.undoLatestEdit,{...run,expectedRevision:editSession.revision,overrideApproved:approvalOverride.active>0});undone=result.undone;return result;
      });
      return {...snapshot,undone,saved:undone,applied:undone,message:undone?'Latest saved edit undone.':'No saved edits to undo.',summary:summarizeTimeline(snapshot.timeline,assets)};
    }}),
    listRevisions:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.listRevisions,description:"The project's saved history, newest first: each revision with its number, time, author, tool, changed clips, summary and fix records. Use it when the user refers to an earlier version ('bring back what we had'); look with getFrames revision, then restoreClip (one clip) or restoreTimeline (the tab). Lists every tab's edits, or one tab's when timelineId is given; clipId narrows to one clip's edits in the open tab (or timelineId's); revision reads one saved edit. historyStartsAt is the oldest restorable revision.",inputSchema:z.object({clipId:z.string().min(1).max(100).optional(),revision:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(100).optional()}),execute:async(_ctx,{clipId,revision,limit})=>{
      return ctx.runQuery(internal.assistant.revisionHistory,{...run,limit:limit??20,...(clipId?{clipId}:{}),...(revision!==undefined?{revision}:{})});
    }}),
    recordFix:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.recordFix,description:"Attach what a fix changed and how it was verified to the exact saved revision returned by the edit. Give the changed clipId, a short summary, and verification evidence with the checked revision, tools, times, results and any remaining discrepancy. This is an agent-authored record, not an automatic verification certificate. It does not edit the timeline or brief. Later turns read these records in listRevisions. A revision must have changed this clip on this tab; staged or unsaved edits cannot receive records.",inputSchema:z.object({clipId:z.string().min(1).max(100),revision:z.number().int().min(0),summary:z.string().trim().min(1).max(1000),verification:z.string().trim().min(1).max(4000)}),execute:async(_ctx,input)=>{
      await editSession.wait();
      if(editSession.staged)throw new Error('Save the staged edit and verify its saved revision before recording a fix.');
      return ctx.runMutation(internal.assistant.recordFix,{...run,...input});
    }}),
    restoreClip:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.restoreClip,description:"Put one clip back exactly as it was at an earlier revision (from listRevisions): media, text, timing, effects, everything. Every other clip stays as it is now. A clip deleted since then comes back. Saves as a new revision and is undoable. Use this, not chains of undoLatestEdit, to return a clip to a known-good version. keepTiming keeps the clip's current start, duration and layer (for when other clips moved into its old place). A video's linked audio is a separate clip: restore it too if its timing changed.",inputSchema:z.object({clipId:z.string().min(1).max(100),revision:z.number().int().min(0),keepTiming:z.boolean().optional()}),execute:async(_ctx,{clipId,revision,keepTiming})=>{
      await editSession.wait();
      const {change,timelineId}=await ctx.runQuery(internal.assistant.revisionChanges,{...run,revision,clipId}) as {timelineId:string;change:{changedAt:number;lastChangedAt:number;before:Clip|null;index?:number}|null};
      const now=editSession.timeline.clips.find(clip=>clip.id===clipId);
      if(!change){
        if(!now)throw new Error(`Clip ${clipId} is not on timeline ${timelineId} now and has no saved history there. Check the ID with listRevisions; for a clip in another tab, pass that timelineId.`);
        return {applied:false,saved:false,unchanged:true,message:`Clip ${clipId} has not changed since revision ${revision}; it already matches.`};
      }
      if(!change.before)throw new Error(`Clip ${clipId} did not exist yet at revision ${revision}: it was added at revision ${change.changedAt}. Pick revision ${change.changedAt} or later from listRevisions${now?', or delete the clip if it should go':''}.`);
      const target=keepTiming&&now?{...change.before,start:now.start,duration:now.duration,track:now.track}:change.before;
      try{
        const result=await checkpoint(t=>placeClip(t,target,change.index));
        return {...result,restored:{clipId,revision,timelineId,...(now?{}:{readded:true,deletedAt:change.lastChangedAt})},message:result.unchanged?`Clip ${clipId} already matches revision ${revision}.`:now?`Clip ${clipId} is back to revision ${revision}.`:`Clip ${clipId} was deleted at revision ${change.lastChangedAt}; it is back as it was at revision ${revision}.`};
      }catch(error){
        const text=error instanceof Error?error.message:String(error);
        throw new Error(/overlap/i.test(text)?`${text} At revision ${revision} the clip sat where another clip is now. Pass keepTiming:true to keep its current place, or move the other clip first.`:text);
      }
    }}),
    restoreTimeline:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.restoreTimeline,description:"Put the whole open timeline tab back to an earlier revision (from listRevisions): every clip and the tab's settings return to that state, clips added since are removed and deleted ones come back. Other tabs are untouched. Saves as a new revision and is undoable. Only when the user wants the whole tab back; for one clip use restoreClip, which keeps later work on the other clips.",inputSchema:z.object({revision:z.number().int().min(0)}),execute:async(_ctx,{revision})=>{
      await editSession.wait();
      const {changes,timelineId}=await ctx.runQuery(internal.assistant.revisionChanges,{...run,revision}) as {timelineId:string;changes:{clipId:string;before:Clip|null;index?:number;rest?:Timeline}[]};
      if(!changes.length)return {applied:false,saved:false,unchanged:true,message:`Timeline ${timelineId} has not changed since revision ${revision}.`};
      const ordered=[...changes].sort((a,b)=>(a.index??Infinity)-(b.index??Infinity));
      const result=await checkpoint(t=>ordered.reduce<Timeline>((next,change)=>change.clipId===TIMELINE_ROW?(change.rest?{...change.rest,clips:next.clips}:next):change.before?placeClip(next,change.before,change.index):{...next,clips:next.clips.filter(clip=>clip.id!==change.clipId)},t));
      return {...result,restored:{revision,timelineId,clipsChanged:changes.filter(change=>change.clipId!==TIMELINE_ROW).length},message:result.unchanged?`Timeline ${timelineId} already matches revision ${revision}.`:`Timeline ${timelineId} is back to revision ${revision}.`};
    }}),
    readBrief:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.readBrief,description:"Read this project's brief: the user's lasting direction for this project (what to keep, what to avoid, style and pacing rules), one rule each with the user's own words. Read it before editing a project, and follow it.",inputSchema:z.object({}),execute:async()=>ctx.runQuery(internal.briefs.forRun,run)}),
    updateBrief:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.updateBrief,description:"Keep the project brief current whenever the user gives direction that should last beyond this one change: what they love and want kept (\"the lockup at 6.3 s is perfect\"), what to avoid, style or pacing rules. Each rule is one short instruction plus the user's own words, quoted. When new direction supersedes a rule (the user changed their mind or refined it), pass that rule's ruleId in replaces instead of adding a second rule beside it; remove drops rules the user withdrew. Not for one-off edit requests. Returns the whole brief.",inputSchema:z.object({set:z.array(z.object({rule:z.string().trim().min(3).max(300).describe('The direction as one short instruction.'),userWords:z.string().trim().min(1).max(600).describe('What the user said, quoted.'),replaces:z.array(z.string().min(1)).max(10).optional().describe('ruleIds this rule supersedes.')})).max(10).optional(),remove:z.array(z.string().min(1)).max(40).optional().describe('ruleIds the user withdrew.')}).refine(input=>input.set?.length||input.remove?.length,{message:'Give rules to set or ruleIds to remove.'}),execute:async(_ctx,{set,remove})=>ctx.runMutation(internal.briefs.update,{...run,set:(set??[]).map(item=>({rule:item.rule,words:item.userWords,...(item.replaces?.length?{replaces:item.replaces}:{})})),remove:remove??[]})}),
    unlink:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.unlink,description:"Unlink an identified video/audio pair while keeping both clips, media, source ranges, timing, volume and settings. After unlink, deleting/trimming/splitting only the video leaves its original audio independent. Select either pair member; preserve other clips. Does not enable the muted separated video's duplicate sound.",inputSchema:z.object({clipId:z.string().min(1).max(100)}),execute:async(_ctx,{clipId})=>{
      let clipIds:string[]=[];
      const result=await checkpoint(t=>{
        const clip=find(t,clipId);if(clip.kind!=='video'&&clip.kind!=='audio')throw new Error('Choose a video or audio clip to unlink.');
        if(!clip.linkedClipId)return t;
        const pair=find(t,clip.linkedClipId);if(pair.linkedClipId!==clip.id)throw new Error('Choose a reciprocal linked video/audio pair.');
        clipIds=[clip.id,pair.id];return unlinkClips(t,clipId);
      });
      return {...result,unlinked:clipIds.length>0,clipIds};
    }}),
    link:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.link,description:"Link video clips with their audio clips again so move, trim, split and delete act on both, as for imported footage: the inverse of unlink. Pass every pair in ONE call. Each pair must already start together, last the same time and play the same source range at the same speed; line them up first if not. The video is muted and its audio clip carries the sound. Only a video and the audio extracted from it can be linked; unlink a clip from another partner first.",inputSchema:z.object({pairs:z.array(z.object({videoClipId:z.string().min(1).max(100),audioClipId:z.string().min(1).max(100)})).min(1).max(200).describe('Video/audio clip pairs to link.')}).refine(input=>new Set(input.pairs.flatMap(pair=>[pair.videoClipId,pair.audioClipId])).size===input.pairs.length*2,{message:'Use each clip in only one pair.'}),execute:async(_ctx,{pairs})=>{
      let linked:{videoClipId:string;audioClipId:string}[]=[];
      const result=await checkpoint(t=>{
        linked=[];
        return pairs.reduce((next,pair)=>{
          const video=find(next,pair.videoClipId),audio=find(next,pair.audioClipId);
          if(video.linkedClipId===audio.id&&audio.linkedClipId===video.id)return next;
          linked.push(pair);
          try{return linkClips(next,video.id,audio.id,videoAssetId=>assets.find(asset=>asset._id===videoAssetId)?.audioAssetId);}catch(error){throw new Error(`${pair.videoClipId} + ${pair.audioClipId}: ${error instanceof Error?error.message:String(error)}`);}
        },t);
      });
      return {...result,linked,alreadyLinked:pairs.length-linked.length};
    }}),
    approveClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.approveClip, description: "Mark a clip as approved: the user signed off on it, and every editing tool then refuses to change it. Use it when the user says they approve, like, or want to keep a clip as it is. note says what was approved, in the user's words. Approving a video approves its linked audio too. Call it only after the user approves; never approve on their behalf.", inputSchema: z.object({ clipId: z.string().min(1), note: z.string().trim().max(APPROVAL_NOTE_LIMIT).optional() }), execute: async (_ctx, { clipId, note }) => {
      const saved = await checkpoint(t => approveClip(t, clipId, note, 'agent'));
      return { ...saved, approved: approvedWork({ ...editSession.timeline, clips: editSession.timeline.clips.filter(clip => clip.id === clipId) })[0] };
    } }),
    unapproveClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.unapproveClip, description: "Remove an approval so the clip can be edited again. Only when the user asks to unlock or change approved work: reason quotes what they asked.", inputSchema: z.object({ clipId: z.string().min(1), reason: z.string().trim().min(3).max(300).describe("What the user asked, in their words.") }), execute: async (_ctx, { clipId }) => {
      const saved = await checkpoint(t => unapproveClip(t, clipId));
      return { ...saved, unapproved: true, clipId };
    } }),
    inspectTimeline: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.inspectTimeline, description: "Read this active project's current working timeline (the open timeline tab, named in openTimeline) and saved revision. If staged is true, this is a private replacement draft that has not been published yet. Expose each labeled layer with its group and number: FX effects-only, V video/image/text/solid-color, A audio. Timeline clips include their kind and track. Report visual coverage gaps, overlaps within the same group/layer, missing media references and effective text animation labels. Higher stacked layers are intentional and are not overlap errors. This tool does not change the timeline or create an undo entry. An animation field of none can still have motion keyframes or a text template: report the effective names from summary.textAnimations.", inputSchema: z.object({}), execute: async () => {
      const snapshot = await editSession.inspect(readSavedTimeline);
      inspected = true;
      const captionedAssetIds=assets.filter(asset=>{
        const speech=captionSpeech(asset.analysis);
        return !!speech&&captionsCoverTranscript(snapshot.timeline,asset._id,speech.transcript,speech.edges);
      }).map(asset=>asset._id);
      const tabs = await ctx.runQuery(internal.assistant.listRunTimelines, run), requestedTab = boundRunTab(run.runId), openTab = tabs.find(tab => requestedTab ? tab.id === requestedTab : tab.active) ?? tabs[0];
      const inspection = { ...snapshot, openTimeline: { timelineId: openTab.id, name: openTab.name, otherTimelines: tabs.filter(tab => tab !== openTab).map(tab => tab.name) }, captionedAssetIds, assets: assets.map(({ _id, fileName, kind, duration, width, height, audioAssetId, imageGeneration }) => ({ assetId: _id, fileName, kind, duration, width, height, audioAssetId })), timeline: modelTimeline(snapshot.timeline, selectedClipIds), layers: deriveTracks(snapshot.timeline), summary: summarizeTimeline(snapshot.timeline, assets), ...approvedNote(snapshot.timeline), brief: await ctx.runQuery(internal.briefs.forRun, run) };
      const inspectionKey = JSON.stringify(inspection);
      // The same answer again adds nothing but context: a small model that keeps re-reading paid for the whole timeline each time.
      if (previousTool === 'inspectTimeline' && inspectionKey === lastInspection) return { unchanged: true, revision: snapshot.revision, staged: snapshot.staged, note: 'Nothing changed since the inspectTimeline call just before this one: same timeline, revision, media and brief. Use that result. Make the next edit, call finish, or ask the user; do not call inspectTimeline again until something changes.' };
      lastInspection = inspectionKey;
      return inspection;
    } }),
    inspectClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.inspectClip, description: "Read one exact current clip including all motion/focus samples and settings omitted from the compact timeline. Uses the working edit session; no edits. Read inspectTimeline first when fresh saved state is needed.", inputSchema: z.object({ clipId: z.string() }), execute: async (_ctx, input) => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId), soundRecipe = assets.find(item => item._id === clip.assetId)?.soundRecipe;
      // Scene and film clips are no longer supported; their code is not returned.
      const { scene: _scene, ...plain } = clip;
      return { clip: _scene ? { ...plain, unsupported: 'Scene clips are no longer supported: they do not render or export. Delete this clip.' } : clip, ...(isApproved(clip) ? { approved: approvedWork({ ...editSession.timeline, clips: [clip] })[0], approvedRule: APPROVED_RULE } : {}), ...(soundRecipe ? { soundRecipe: JSON.parse(soundRecipe) } : {}), revision: editSession.revision, staged: editSession.staged };
    } }),
    detectFacecam:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.detectFacecam,description:'Detect the webcam OVERLAY panel and gameplay regions using local MediaPipe faces and temporally stable OpenCV rectangle edges in the media processor. No Gemini key is required. Returns normalized x/y/w/h rectangles, source sample times, confidence and explicit creator-only/gameplay-only/uncertain outcomes. Reuses saved source analysis. If no clear panel is found, use followSubject mode face or retain a wider view. Use applyLayout detectedRegions:true for automatic creator-top/gameplay-bottom crops; inspect layout changes between samples.',inputSchema:z.object({assetId:z.string()}),execute:async(_ctx,{assetId})=>{if(lane==='clip'){const state=await ctx.runQuery(internal.clipping.completionState,{...clippingRun});if(!('found' in state)||state.required&&state.accepted===0)throw stepOrderGuard('Complete findHighlights and planClips before facecam framing. This reuses the discovered source instead of downloading it twice in parallel.');}const asset=await analyze(assetId,'facecam');return {assetId:asset._id,...asset.analysis?.facecam,...(asset.analysis?.facecam?.samples.some(s=>s.kind==='uncertain')?{fallback:'Use followSubject mode face for uncertain layouts; keep a wider frame if no face is visible.'}:{})};}}),
    analyzeMedia: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.analyzeMedia, description: "Start durable analysis of this project's uploaded media by mode: word-timed transcription with audio energy, shots (local scene cuts, no Gemini), a Gemini video overview, music beats, face track (faces only; other objects use trackPoints), facecam regions, or speakers (diarized speakers with face positions). Saved results are usable at once: reuse them. Overviews are optional and run only for footage with little speech; a skipped or failed one returns unavailable: continue with the transcript and readFrames without waiting, retrying or reporting a provider error. For a specific visual question use inspectVideo. Shot cuts can miss dissolves and do not identify impacts.", inputSchema: z.object({ assetId: z.string(), mode: z.enum(["transcribe", "understand", "shots", "beats", "track", "facecam", "speakers"]),start:z.number().min(0).optional(),end:z.number().positive().optional() }).refine(i=>(i.start===undefined&&i.end===undefined)||(i.mode==='speakers'&&i.start!==undefined&&i.end!==undefined&&i.end>i.start&&i.end-i.start<=120),{message:'Source start/end windows are for speaker analysis, up to 120 seconds.'}), execute: async (_ctx, input) => {
      return reportAnalysisFailure(async () => {
      const asset = input.mode === 'understand' ? await loadAsset(input.assetId) : await analyze(input.assetId, input.mode,false,input.start!==undefined&&input.end!==undefined?{start:input.start,end:input.end}:undefined);
      if (input.mode === 'understand' && !asset.analysis?.understanding) return understandingUnavailable(input.assetId);
      return { analyzed: true, assetId: asset._id, mode: input.mode, ...(input.mode==='facecam'?{facecam:asset.analysis?.facecam}:{}), ...(input.mode==='speakers'?{start:asset.analysis?.speakers?.start,end:asset.analysis?.speakers?.end,identityScope:asset.analysis?.speakers?.identityScope,turnCount:asset.analysis?.speakers?.turns.length,framing:asset.analysis?.speakers?summarizeSpeakerFraming(asset.analysis.speakers,input.start,input.end):null,readTool:'inspectAssetAnalysis with start/end SOURCE seconds'}:{}), ...(input.mode === "transcribe" ? { segmentCount: asset.analysis?.transcript?.segments.length, wordCount: asset.analysis?.transcript?.words.length } : {}), ...(input.mode === "understand" ? { summary: asset.analysis?.understanding?.summary, sceneCount: asset.analysis?.understanding?.scenes.length } : {}), ...(input.mode === "beats" ? { bpm: asset.analysis?.beats?.bpm, sectionCount: asset.analysis?.beats?.beats.length, downbeatCount: asset.analysis?.beats?.downbeats?.length ?? 0, accentCount: asset.analysis?.beats?.accents?.length ?? 0, dropCandidateCount: asset.analysis?.beats?.dropCandidates?.length ?? 0, engine: asset.analysis?.beats?.engine, confidence: asset.analysis?.beats?.confidence } : {}), ...(input.mode === "track" ? { sampleCount: asset.analysis?.focus?.length } : {}) };
      });
    } }),
    inspectVideo: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.inspectVideo, description: "Optional Gemini inspection of an uploaded video for the user's actual visual question (a fight, a reaction, an object). Not for trims, cuts, take selection or repeats unless the user asked for a visual check; the transcript finds words. start/end SOURCE seconds: only that window is uploaded; in clipping at most 60 s per window, 12 windows and 600 s per batch, and an identical window reuses its saved answer. Returns source windows, an answer, uncertainty and matches mapped onto timeline clips; zero matches is valid. available:false explains the outage: do not retry other windows or inspectFrames this run, and leave visual action unresolved. Details: readSkill visual-inspection.", inputSchema: z.object({ assetId: z.string(), question: z.string().min(1).max(MAX_INSPECTION_QUESTION), start: z.number().min(0).optional(), end: z.number().positive().optional() }), execute: async (_ctx, input) => {
      const asset = assets.find(item => item._id === input.assetId);
      if (asset?.kind !== 'video' || !asset.duration) throw new Error('Choose a video source from this project.');
      const videoRequest = { question: input.question.trim(), start: input.start ?? 0, end: input.end ?? asset.duration };
      if (lane === 'clip' && (input.start === undefined || input.end === undefined || input.end-input.start > 60))
        throw new Error('Clipping inspects explicit candidate SOURCE windows of at most 60 seconds, never the whole source by default.');
      validateVideoInspectionInput(videoRequest, asset.duration);
      const reservation = lane === 'clip' ? await ctx.runMutation(internal.clipping.reserveVisual, { ...clippingRun, assetId: asset._id, ...videoRequest }) : null;
      if (reservation?.cached) return { assetId: asset._id, ...reservation.cached, cached: true, scope: reservation.cached.available === false ? 'Cached unavailability; no visual observation was obtained.' : 'Saved targeted native-video observation; source times only.' };
      if (reservation?.pending) return { available: false, reason: 'This exact video window is already being inspected. Reuse its observation after completion; do not duplicate the request.' };
      const output = await optionalVideoInspection(() => withAnalysis(input.assetId, 'video', async request => {
        if (!request.videoInspection) throw new Error('Native video inspection completed without saved evidence.');
        await editSession.wait();
        const evidence = request.videoInspection;
        return { assetId: input.assetId, ...evidence, matchCount: evidence.matches.length, timelineOccurrences: editSession.timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId === input.assetId).map(clip => ({ clipId: clip.id, sourceStart: clip.sourceStart, timelineStart: clip.start, duration: clip.duration, playbackRate: playbackRateOf(clip), matches: videoMatchesOnClip(evidence, clip).map(match=>{const evidenceId=crypto.randomUUID();visualEvidence.set(evidenceId,{clipIds:[clip.id],start:match.timelineStart,end:match.timelineEnd});return {...match,evidenceId};}) })) };
      }, { videoRequest }));
      if (reservation?.token) await ctx.runMutation(internal.clipping.recordVisual, { ...clippingRun, token: reservation.token, result: JSON.stringify({ ...output, timelineOccurrences: undefined }) });
      return output;
    } }),
    inspectFrames: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.inspectFrames, description: "Gemini look at decoded frames in a focused SOURCE window (start/end, at most 3 s, up to 12 frames) for a precise visual question: a script glance, a cut boundary, or locating a named zoom target (returns source boxes and targetIds for configureSmoothZoom, configureCameraMotion and trackPoints). precision consecutive verifies a brief glance: localize first, then refine in the returned window. Not for speech cuts or take selection unless the user asked for a visual check, and never one call per cut. No timeline changes; sparse frames cannot prove motion, silence or sync. Details: readSkill visual-inspection.", inputSchema: z.object({ assetId: z.string(), question: z.string().trim().min(1).max(1000), start: z.number().min(0), end: z.number().positive(), precision: z.enum(['sampled', 'consecutive']).optional() }), execute: async (_ctx, input) => {
      const asset = assets.find(item => item._id === input.assetId);
      if (asset?.kind !== 'video' || !asset.duration) throw new Error('Choose a video source from this project.');
      const frameRequest = { start: input.start, end: input.end, question: input.question.trim() };
      validateFrameInspectionInput(frameRequest, asset.duration);
      return optionalVideoInspection(() => withAnalysis(input.assetId, 'frames', async request => {
        if (!request.frameInspection) throw new Error('Frame inspection completed without saved evidence.');
        await editSession.wait();
        const evidence = request.frameInspection;
        const coverage = frameInspectionCoverage(evidence);
        if (input.precision === 'consecutive') {
          try { assertConsecutiveInspection(evidence); }
          catch (error) { return { success:false as const, code:'FRAME_REFINEMENT_REQUIRED', error:(error as Error).message, assetId:input.assetId, coverage }; }
        }
        const targets=rememberZoomTargets(evidence,input.assetId,zoomTargets);
        return { assetId: input.assetId, ...evidence,targets, coverage, precision: input.precision ?? 'sampled', inspectedFrameCount: evidence.frames.length, scope: 'Decoded still images only; timestamps identify sampled frames, not continuous event boundaries or audio evidence.', timelineOccurrences: editSession.timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId === input.assetId).map(clip => ({ clipId: clip.id, sourceStart: clip.sourceStart, timelineStart: clip.start, duration: clip.duration, playbackRate: playbackRateOf(clip), ...frameEvidenceOnClip(evidence, clip) })).filter(clip => clip.frames.length > 0) };
      }, { frameRequest }));
    } }),
    editText: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.editText, description: "Change an existing caption or graphic's text and save immediately. Preserve its timing and style. With saved speech evidence, captions must match the measured phrase inside that timing; case and punctuation corrections are allowed. A caption's new words and range go in one call: start/end (timeline seconds) retime it as setCaptionTiming does, with neighbouring captions making room. Never add unspoken words.", inputSchema: z.object({ clipId: z.string(), text: z.string().max(2000), start: z.number().min(0).optional().describe('Captions only: new timeline start, as setCaptionTiming.'), end: z.number().min(0).optional().describe('Captions only: new timeline end, as setCaptionTiming.') }), execute: async (_ctx, input) => {
      let retimed: ReturnType<typeof updateCaptionTiming> | undefined;
      const result = await checkpoint(t => {
        const clip = find(t, input.clipId); if (clip.kind !== "caption" && clip.kind !== "graphic") throw new Error("Choose a caption or text graphic");
        if ((input.start !== undefined || input.end !== undefined) && clip.kind !== 'caption') throw new Error('start and end retime captions only; move a text graphic with resizeClips or move.');
        let next = patchClip(t, input.clipId, { text: input.text });
        // The new words decide which neighbours it may absorb, so the range is set after the text.
        if (input.start !== undefined || input.end !== undefined) { retimed = updateCaptionTiming(next, input.clipId, { start: input.start, end: input.end }); next = retimed.timeline; }
        if (clip.kind === 'caption') {
          const words = retainedSpeechWords(next, assets), edited = find(next, input.clipId);
          const mismatch = words.length ? captionSyncFailures({ ...next, clips: [edited] }, words, { checkCoverage: false, checkTiming: false })[0] : undefined;
          if (mismatch) throw new Error(mismatch);
        }
        return next;
      });
      return { ...result, ...captionTimingReport(retimed) };
    } }),
    styleCaptions: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.styleCaptions, description: "Batch-style existing captions and text graphics using exact clipIds. Without IDs, target captions only. Compose a custom style with installed font, size, weight, italic, spacing, line height, alignment, text-box padding/radius, solid colors, position, rotation, blend, stroke/shadow/glow and optional textCase in one call. Presets are optional starting points, not a requirement. Preserve words unless textCase is explicitly requested, and always preserve timing. Preserve its animation unless explicitly supplied; animation replaces the prior selection independently of appearance. Save immediately.", inputSchema: z.object({ clipIds: z.array(z.string()).min(1).max(200).optional(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), rotation:z.number().min(-360).max(360).optional(),textStyle:textStyleInput.optional(), textCase:z.enum(['sentence','upper','lower']).optional(), animation:z.enum(TEXT_ANIMATION_PRESETS).optional() }), execute: async (_ctx, input) => checkpoint(t => {
      const {clipIds,animation,...style}=input;
      const hasStyle=Object.values(style).some(value=>value!==undefined);
      if(!hasStyle&&animation===undefined)throw new Error('Specify a caption style or animation control.');
      const next=hasStyle?(clipIds?patchTextStyles(t,style,clipIds):patchCaptionStyles(t,style)):t;
      if(animation===undefined)return next;
      if(clipIds?.some(id=>!['caption','graphic'].includes(find(next,id).kind)))throw new Error('Choose caption or text graphic clips only.');
      const selected=new Set(clipIds??next.clips.filter(clip=>clip.kind==='caption').map(clip=>clip.id));
      if(!selected.size)throw new Error('This timeline has no saved captions.');
      return {...next,clips:next.clips.map(clip=>selected.has(clip.id)?{...clip,...textAnimationPatch(clip,animation)}:clip)};
    }) }),
    styleTextClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.styleTextClip, description: "Style a selected caption/text graphic's requested font, size, solid colors, position, rotation, animation or blend. Preserve omitted controls, words and timing. Appearance and animation are separate; an explicit animation replaces the prior selection. Save immediately.", inputSchema: z.object({ clipId: z.string(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), rotation:z.number().min(-360).max(360).optional(), textStyle:textStyleInput.optional(), animation:z.enum(TEXT_ANIMATION_PRESETS).optional() }), execute: async (_ctx, input) => checkpoint(t => {
      const { clipId, rotation,animation, ...style } = input; const clip = find(t, clipId);
      if (clip.kind !== "caption" && clip.kind !== "graphic") throw new Error("Choose a caption or text graphic");
      if (rotation===undefined&&animation===undefined&&!Object.values(style).some(value => value !== undefined)) throw new Error("Specify a text style change");
      const next=rotation!==undefined||Object.values(style).some(value=>value!==undefined)?patchTextStyles(t,{...style,...(rotation!==undefined?{rotation}:{})},[clipId]):t;
      return animation!==undefined?patchClip(next,clipId,textAnimationPatch(find(next,clipId),animation)):next;
    }) }),
    setTextGradient:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setTextGradient,description:"Set a static or animated gradient fill on exact caption/text-graphic clipIds in one call: 2–5 hex colors and an angle in degrees; enabled:false restores the solid color. animation {enabled, duration seconds per pass, direction, loop} moves the gradient inside the letters; animation enabled:false freezes it. Omitted controls are kept (a new gradient defaults to white/purple at 90°); words, background, font, motion and timing are kept, and a karaoke active-word highlight stays readable.",inputSchema:z.object({clipIds:clipIdsInput,enabled:z.boolean(),colors:z.array(textColor.refine(color=>color!=='transparent')).min(2).max(5).optional(),angle:z.number().min(0).max(360).optional(),animation:z.object({enabled:z.boolean(),duration:z.number().min(.2).max(60).optional(),direction:z.enum(['forward','reverse']).optional(),loop:z.boolean().optional()}).strict().optional()}).strict(),execute:async(_ctx,{clipIds,...changes})=>checkpoint(t=>{const patches=new Map(clipIds.map(id=>[id,textGradientPatch(find(t,id),changes)]));return {...t,clips:t.clips.map(clip=>patches.has(clip.id)?{...clip,...patches.get(clip.id)}:clip)};})}),
    setTextStyle:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setTextStyle,description:"Design a caption/text graphic appearance from individual controls, without selecting a preset: fontWeight100..900 (clamped to the installed face), italic, letterSpacing -10..100px, lineHeight .5..3, textAlign left/center/right, paddingX/Y and borderRadius0..200px, plus stroke, shadow and glow. Pixel values use a 1080 shorter output dimension; 0 width/blur disables that feature. Colors are six-digit hex. Preserve omitted controls, words, timings, fonts, position, rotation and independent text animation. Saves immediately.",inputSchema:textStyleInput.extend({clipId:z.string()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a text appearance control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>{const clip=find(t,clipId);if(clip.kind!=='caption'&&clip.kind!=='graphic')throw new Error('Choose a caption or text graphic.');return patchClip(t,clipId,{textStyle:{...resolvedTextAppearance(clip),...changes}})})}),
    applyTextLook:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyTextLook,description:"Apply a requested text look, or one justified by authorized creative text styling, to a caption/graphic. Styles set solid fill/background/size/blend/stroke/shadow/glow only. Every style preserves the existing animation, custom motion, effect color, strength, timing, stagger and word timings. Default text resets appearance only; Neon Echo does not add or replace motion. Words, clip timing, position, rotation and font remain. Use setTextAnimation only when the user requests an animation change.",inputSchema:z.object({clipId:z.string(),look:z.enum(TEXT_LOOKS.map(look=>look.id))}),execute:async(_ctx,{clipId,look})=>checkpoint(t=>patchClip(t,clipId,textLookPatch(find(t,clipId),look)))}),
    setTextAnimation:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setTextAnimation,description:"Choose a supported caption/graphic animation independently of text appearance: None, Fade, Rise, Pop in, Word reveal, Pop-in words, Sliding title, Karaoke, Neon Echo, Lyric Slam, Kinetic Stack, Chromatic split, Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on or Echo tunnel. Replace the prior animation, preserve words/style/font/rotation/timing. Karaoke preserves saved speech-word timings when present; otherwise it uses even duration progress, not detected syllables or beat sync.",inputSchema:z.object({clipId:z.string(),animation:z.enum(TEXT_ANIMATION_PRESETS)}),execute:async(_ctx,{clipId,animation})=>{const saved=await checkpoint(t=>patchClip(t,clipId,textAnimationPatch(find(t,clipId),animation)));return {...saved,effectiveAnimation:TEXT_ANIMATION_LABELS[animation]}}}),
    applyCaptionStyle:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyCaptionStyle,description:`Restyle caption clips only: all saved captions, or exact caption targetClipIds, in one call. Pass exactly one of preset (number or name: ${CAPTION_PRESETS.map(preset => `${preset.number} ${preset.id}`).join(', ')}) or sourceClipId (copy that caption's font, size, colors, position, stroke, shadow and glow). Each target keeps its words, timing and position. popScale and popSpeed tune the spoken-word pop only when asked. Titles use styleCaptions with clipIds; new captions use addSubtitlesFromTranscript with preset. Preset looks: readSkill footage-editing page text-styling.`,inputSchema:z.object({preset:captionPresetInput.optional(),sourceClipId:z.string().optional(),targetClipIds:z.array(z.string()).min(1).max(200).optional(),popScale:z.number().min(CAPTION_MOTION_LIMITS.popScale[0]).max(CAPTION_MOTION_LIMITS.popScale[1]).optional(),popSpeed:z.number().min(CAPTION_MOTION_LIMITS.popDuration[0]).max(CAPTION_MOTION_LIMITS.popDuration[1]).optional()}).refine(input=>(input.preset===undefined)!==(input.sourceClipId===undefined),{message:'Pass exactly one of preset or sourceClipId.'}),execute:async(_ctx,{preset,sourceClipId,targetClipIds,popScale,popSpeed})=>{
      if(sourceClipId!==undefined)return checkpoint(t=>applyCaptionStyle(t,sourceClipId,targetClipIds));
      const chosen=resolveCaptionPreset(preset!);
      // Captions made without word timings get them from the transcript of the footage beneath them.
      await editSession.wait();
      const speech=new Map<string,{transcript:Transcript;edges?:number[]}>();
      const sources=captionTimingSources(editSession.timeline,targetClipIds).filter(id=>{const known=assets.find(asset=>asset._id===id);return !!known&&(!!known.analysisKinds?.includes('transcribe')||!!known.analysis?.transcript);});
      await Promise.all(sources.map(async id=>{const loaded=await loadAsset(id).catch(()=>undefined),saved=loaded&&captionSpeech(loaded.analysis);if(saved)speech.set(id,saved);}));
      const result=await checkpoint(t=>applyCaptionPreset(t,chosen.id,targetClipIds,speech,{...(popScale!==undefined?{popScale}:{}),...(popSpeed!==undefined?{popDuration:popSpeed}:{})}));
      return {...result,preset:{number:chosen.number,name:chosen.name,id:chosen.id}};
    }}),
    setCaptionTiming:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setCaptionTiming,description:"Set an existing caption's absolute timeline start/end in seconds, snapped to project frames. Preserve its spoken words and original animation phase; it never generates text or moves footage. Neighbouring captions on its track make room in the same change: an overlapped edge is trimmed, and a neighbour that would be covered (or left mostly covered) is removed only when all its words are in this caption's text; the result's neighbours lists each one. To reword and retime, editText first, then setCaptionTiming. Refuses ranges shorter than one frame, a range inside a neighbour (it would need a split), covering a neighbour whose words this caption does not say, and overlapping a non-caption clip on its V track.",inputSchema:z.object({clipId:z.string(),start:z.number().min(0).optional(),end:z.number().min(0).optional()}).refine(input=>input.start!==undefined||input.end!==undefined,{message:'Specify caption start or end.'}),execute:async(_ctx,{clipId,...range})=>{
      let retimed:ReturnType<typeof updateCaptionTiming>|undefined;
      const result=await checkpoint(t=>{retimed=updateCaptionTiming(t,clipId,range);return retimed.timeline;});
      return {...result,...captionTimingReport(retimed)};
    }}),
    normalizeAudio:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.normalizeAudio,description:"Normalize a clip (clipId; a video targets its linked sound) or the whole timeline (omit clipId; up to ten minutes) to social loudness, default -14 LUFS integrated with true peak at most -1 dBTP; the media worker measures the retained mix and verifies the result, and preview and export use the same file. Run it after timing and mix are final: later edits bypass it until normalized again. enabled:false removes saved normalization at once. Silent or unmeasurable audio fails without editing.",inputSchema:z.object({clipId:z.string().min(1).optional(),enabled:z.boolean().optional(),targetLufs:z.number().min(-24).max(-9).optional(),truePeak:z.number().min(-6).max(-1).optional()}),execute:async(_ctx,input)=>{
      await editSession.wait();
      const frozen=JSON.stringify(editSession.timeline),selected=input.clipId?find(editSession.timeline,input.clipId):undefined;
      const target=selected?.kind==='video'&&selected.linkedClipId?find(editSession.timeline,selected.linkedClipId):selected;
      if(target&&target.kind!=='audio')throw new Error('Choose an audio clip or a video with linked sound.');
      if(input.enabled===false)return checkpoint(t=>target?{...t,clips:t.clips.map(c=>c.id===target.id?{...c,normalizedAudio:undefined}:c)}:{...t,audioNormalization:undefined});
      const cached=target?.normalizedAudio??(!target?editSession.timeline.audioNormalization:undefined),cacheKey=target?audioNormalizationKey(editSession.timeline,target):timelineNormalizationKey(editSession.timeline);
      if(cached?.outputLufs!==undefined&&cached.measuredTruePeak!==undefined&&cached.key===cacheKey&&cached.targetLufs===(input.targetLufs??-14)&&cached.truePeak===(input.truePeak??-1))return {applied:false,alreadyNormalized:true,assetId:cached.assetId,targetLufs:cached.targetLufs,truePeakCeiling:cached.truePeak};
      const timelineId=boundRunTab(run.runId),snapshotId=await ctx.runMutation(internal.mcp.requestFrames,{ownerId:run.ownerId,projectId:run.projectId,...(editSession.staged?{runId:run.runId}:{}),...(timelineId?{timelineId}:{}),times:[],normalization:{...(input.clipId?{clipId:input.clipId}:{}),targetLufs:input.targetLufs??-14,truePeak:input.truePeak??-1}});
      try{
        const deadline=Date.now()+540_000;
        while(true){
          abortSignal.throwIfAborted();
          const state=await ctx.runQuery(internal.mcp.frames,{ownerId:run.ownerId,snapshotId});
          if(state.status==='failed')throw new AnalysisStepError(state.error??'Loudness normalization failed.');
          if(state.status==='completed'){
            const result=state.normalization;
            if(!result)throw new Error('The normalized audio result is missing.');
            await adoptAsset(result.assetId);
            const saved=await checkpoint(t=>{
              if(JSON.stringify(t)!==frozen)throw new Error('The timeline changed during normalization. Normalize its current mix again.');
              if(target)return {...t,clips:t.clips.map(c=>c.id===target.id?{...c,normalizedAudio:{assetId:result.assetId,key:audioNormalizationKey(t,c),targetLufs:input.targetLufs??-14,truePeak:input.truePeak??-1,outputLufs:result.outputLufs,measuredTruePeak:result.truePeak}}:c)};
              return {...t,audioNormalization:{assetId:result.assetId,key:timelineNormalizationKey(t),targetLufs:input.targetLufs??-14,truePeak:input.truePeak??-1,outputLufs:result.outputLufs,measuredTruePeak:result.truePeak}};
            });
            const current=target?editSession.timeline.clips.find(c=>c.id===target.id):undefined;
            const baked=target?current?.normalizedAudio:editSession.timeline.audioNormalization;
            const key=current?audioNormalizationKey(editSession.timeline,current):timelineNormalizationKey(editSession.timeline);
            if(baked?.key!==key)return {...saved,normalized:false,stale:true,note:'The sound changed concurrently. The old normalization is bypassed; normalize the current mix again.'};
            return {...saved,normalized:true,loudness:result,note:target?'Sound settings are baked into this clip. Normalize again after changing timing or mix.':'The normalized mix plays in preview and export. Later timing or mix edits automatically bypass it; normalize again when finished.'};
          }
          if(Date.now()>deadline)throw new AnalysisStepError('Loudness normalization is still processing. Try again when the worker finishes.');
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }finally{await safely('discardFrames',()=>ctx.runMutation(internal.mcp.discardFrames,{snapshotId}));}
    }}),
    configureAudio:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureAudio,description:"Configure explicitly requested audio fades/role or lower music under voice clips. Pass clipIds to apply the same change to several clips in ONE call and one saved revision; prefer it over repeated calls, with no inspectTimeline needed between them. Every id is checked first; one bad id fails the whole call unchanged. A linked video targets its separate audio. role original/voice/music is a user label, never inferred speech detection. Only music with ducking.enabled is attenuated during audible voice-labeled clip coverage; amount 0..1 is attenuation, attack/release seconds shape entry/recovery. Fades are timeline seconds at clip edges; preserve source/playback rate/timing/volume and omitted controls. No analysis is needed.",inputSchema:z.object({clipId:z.string().min(1).optional(),clipIds:batchAudioIdsInput.optional(),role:z.enum(AUDIO_ROLES).optional(),fadeIn:z.number().min(0).max(AUDIO_LIMITS.fadeIn[1]).optional(),fadeOut:z.number().min(0).max(AUDIO_LIMITS.fadeOut[1]).optional(),ducking:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),attack:z.number().min(0).max(AUDIO_LIMITS.attack[1]).optional(),release:z.number().min(0).max(AUDIO_LIMITS.release[1]).optional()}).refine(input=>Object.values(input).some(value=>value!==undefined),{message:'Specify a music ducking control.'}).optional()}).refine(oneClipTarget,{message:'Choose clipId or clipIds, never both.'}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&key!=='clipIds'&&value!==undefined),{message:'Specify an audio control.'}),execute:async(_ctx,{clipId,clipIds,...changes})=>{let changed=0;const result=await checkpoint(t=>{const targets=audioTargets(t,clipIds??[clipId!],(_clip,target)=>{if(!target)throw new Error('it has no linked sound');audioSettingsPatch(target,changes)});changed=targets.length;return targets.reduce((next,target)=>configureAudio(next,target,changes),t)});return {...result,changed}}}),
    setVolume: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setVolume, description: "Set volume from 0 (muted) through 1 (100%, original volume) to 2 (200%, boosted). A linked video controls its separate audio clip. Pass clipId; clipIds to set the same volume on several clips (e.g. mute 6 shots) in ONE call and one saved revision; or at: a timeline second to set the shot showing there ('mute 25 s' is setVolume {at:25, volume:0}). Prefer one call over repeated calls, with no inspectTimeline needed between them. Every id is checked first; one bad id fails the whole call unchanged.", inputSchema: z.object({ clipId: z.string().min(1).optional(), clipIds: batchAudioIdsInput.optional(), at: shotTimeInput.optional(), track: shotTrackInput, volume: z.number().min(0).max(2) }).refine(input => [input.clipId, input.clipIds, input.at].filter(value => value !== undefined).length === 1, { message: 'Choose exactly one of clipId, clipIds or at.' }), execute: async (_ctx, input) => { let changed = 0; const result = await checkpoint(t => {
      const ids = input.at !== undefined ? [shotAt(t, input.at, input.track).id] : input.clipIds ?? [input.clipId!]; changed = audioTargets(t, ids, clip => { if (clip.kind !== "video" && clip.kind !== "audio") throw new Error("choose a video or audio clip"); }).length;
      return ids.reduce((next, id) => patchClip(next, id, { volume: input.volume }), t);
    }); return { ...result, changed }; } }),
    addSubtitlesFromTranscript: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addSubtitlesFromTranscript, description: "Add captions from this asset's saved transcript to each retained source occurrence, after the final cuts. Default: minimal static phrases of up to six words with NO background, synced to retained speech; in the clip lane the default is the clipper style (needs word timings). style overrides the lane default only when the user asks; preset (number or name) when the user names a preset or a look one matches. Discarded words never reappear and text is never guessed: without word timings only fully retained sentences are captioned. Respect explicit no-captions or styling requests.", inputSchema: z.object({ assetId: z.string(), style: z.enum(['minimal', 'clipper']).optional(), preset: captionPresetInput.optional().describe('A caption preset by number or name, so "add captions in Bold Pop" is one call: short captions with word timings in that look and its word-by-word pop. See applyCaptionStyle for the list. Overrides style.') }), execute: async (_ctx, input) => savedCheckpoint(input.assetId,t => {
      const asset = assets.find(a => a._id === input.assetId); const rawTranscript = asset?.analysis?.transcript;
      if (!rawTranscript || (!rawTranscript.words.length && !rawTranscript.segments.length)) throw new Error("Run Auto subtitles on this source first; no transcript is saved");
      const captions = sourceCaptions(t.clips.filter(clip => clip.assetId === input.assetId), captionSpeech(asset.analysis)!, t.fps, () => crypto.randomUUID(), input.preset !== undefined ? { preset: resolveCaptionPreset(input.preset).id } : input.style ?? (lane === 'clip' ? 'clipper' : 'minimal'));
      if (!captions.length) throw new Error("Add a source clip that overlaps its transcript before adding subtitles");
      return captions.reduce((timeline, clip) => placeOnFreeLayer(timeline, clip), t);
    }) }),
    markMusicBeats: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.markMusicBeats, description: "Add orange markers in a specific audio clip without moving or cutting clips. Choose kind beats for musical pulse (default), downbeats for bar starts, accents for main/strong/audible hits useful for flashes or zooms, or dropCandidates for uncertain energy rises. Never substitute every beat for requested main hits. Analyze automatically if the current requested map is missing. Optional start/end are timeline seconds within that clip. Preserve existing markers and avoid duplicates. Drop candidates are possible drops to check by ear, not verified musical drops; inspect their evidence and explain uncertainty first unless the user explicitly requests candidate markers.", inputSchema: z.object({ clipId: z.string(), kind: z.enum(['beats', 'downbeats', 'accents', 'dropCandidates']).optional(), start: z.number().min(0).optional(), end: z.number().positive().optional() }), execute: async (_ctx, input) => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId);
      let asset=clip.assetId?await loadAsset(clip.assetId):undefined;
      if (clip.kind !== 'audio' || !asset) throw new Error('Choose the song’s audio clip.');
      const kind = input.kind ?? 'beats';
      if (asset.analysis?.beats?.engine !== BEAT_ANALYSIS_ENGINE || asset.analysis.beats[kind] === undefined) asset = await analyze(asset._id, 'beats');
      let markers!: ReturnType<typeof addBeatMarkers>;
      const result = await checkpoint(timeline => {
        markers = addBeatMarkers(timeline, input.clipId, asset!.analysis?.beats, { ...input, kind });
        return markers.timeline;
      });
      return { ...result, kind, added: markers.added, skipped: markers.skipped, confidence: markers.confidence, status: markers.status, message: markers.message };
    } }),
    analyzeMusic: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.analyzeMusic, description: "Read a song's measured structure: tempo, bars with downbeats, loudness, low band and onsets; sections (low, build, peak, drop, outro) with confidence; the strongest moments ranked on downbeats with their jumps and the first sung line; and the best windows for each edit length in whole bars. Times are SOURCE seconds of the song, plus timeline seconds with clipId. Measures on first use, then reads the saved result. Follow with startMusicAt.", inputSchema: z.object({ clipId: z.string().min(1).optional().describe('The song\'s audio clip on the timeline (or a video with linked audio); adds timeline times.'), assetId: z.string().min(1).optional().describe('A song in the project media that is not on the timeline yet.'), lengths: z.array(z.number().min(3).max(300)).min(1).max(4).optional().describe('Target edit lengths in timeline seconds for the recommended windows (default 15 and 30).') }).strict().refine(input => (input.clipId === undefined) !== (input.assetId === undefined), { message: 'Choose clipId or assetId.' }), execute: async (_ctx, input) => {
      const song = await readSong(input);
      const { structure, clip, asset } = song;
      const sourceEnd = clip ? sourceEndOf(clip) : 0;
      const onTimeline = (time: number) => clip ? { timeline: Math.round(timelineTimeAtSource(clip, time) * 1000) / 1000, inClip: time >= clip.sourceStart - 1e-3 && time < sourceEnd } : {};
      return {
        assetId: asset._id, ...(clip ? { clipId: clip.id, clipSource: { start: clip.sourceStart, end: Math.round(sourceEnd * 1000) / 1000 } } : {}),
        bpm: structure.bpm, beatsPerBar: structure.beatsPerBar, barSeconds: structure.barSeconds, phraseSeconds: { fourBars: Math.round(structure.barSeconds * 4 * 100) / 100, eightBars: Math.round(structure.barSeconds * 8 * 100) / 100 }, beatConfidence: structure.beatConfidence,
        loudness: { loudBarLufs: structure.loudLufs, quietBarLufs: structure.quietLufs, note: 'Section and moment dB are against loudBarLufs, the 90th percentile bar.' },
        sections: structure.sections.map(section => ({ ...section, ...(clip ? { timelineStart: onTimeline(section.start).timeline, timelineEnd: onTimeline(section.end).timeline } : {}) })),
        moments: structure.moments.map(moment => ({ ...moment, ...onTimeline(moment.time) })),
        windows: structure.windows.map(window => ({ ...window, ...(clip ? { timelineStart: onTimeline(window.start).timeline } : {}) })),
        bars: { columns: ['bar', 'start', 'lufs', 'low', 'onsetsPerSecond'], rows: structure.bars.map(bar => [bar.bar, bar.start, bar.lufs, bar.low, bar.onsetsPerSecond]) },
        ...(structure.measuredUntil < (asset.duration ?? 0) - 1 ? { measuredUntil: structure.measuredUntil } : {}),
        ...(song.words.length ? {} : { lyrics: 'No saved transcript for this song, so sung lines are not named. analyzeMedia mode transcribe adds them.' }),
        next: clip ? 'Start the song on a moment with startMusicAt (moment rank, or a window start as sourceTime, plus length). Then listen with getSound from 2 s before to 4 s after its timeline start: the onsets and the momentary loudness should rise at that second.' : 'Place the song with addMedia, then startMusicAt with its clipId.',
      };
    } }),
    startMusicAt: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.startMusicAt, description: "Start a song's audio clip at a chosen musical moment, exactly on a downbeat, without doing bar maths: moment is a rank from analyzeMusic (default 1, the strongest), or sourceTime is a SOURCE second (snapped to the nearest downbeat, e.g. a window start). length (seconds) is rounded to whole bars, whole 4-bar phrases when close, so the song ends on a bar line; without it the clip keeps its current length. at moves the clip's timeline start (default: it stays where it is). The song's existing fades, volume and ducking are kept.", inputSchema: z.object({ clipId: z.string().min(1), moment: z.number().int().min(1).max(5).optional(), sourceTime: z.number().min(0).optional(), length: z.number().min(1).max(3600).optional(), at: z.number().min(0).optional() }).strict(), execute: async (_ctx, input) => {
      if (input.moment !== undefined && input.sourceTime !== undefined) throw new Error('Choose moment or sourceTime, not both.');
      await editSession.wait();
      const target = find(editSession.timeline, input.clipId);
      if (target.kind !== 'audio' || !target.assetId) throw new Error('Choose the song\'s audio clip.');
      if (target.linkedClipId) throw new Error('This song plays with its video. Unlink them first (unlink), then start the audio at a moment.');
      if (target.speedRamp?.length) throw new Error('This song has a speed ramp; remove it before starting the song at a moment.');
      const rate = playbackRateOf(target);
      const { structure, clip, asset, map } = await readSong({ clipId: input.clipId, ...(input.length !== undefined ? { lengths: [input.length] } : {}) });
      if (!clip) throw new Error('Choose the song\'s audio clip.');
      const chosen = input.sourceTime === undefined ? structure.moments[(input.moment ?? 1) - 1] : undefined;
      if (input.sourceTime === undefined && !chosen) throw new Error(`analyzeMusic found ${structure.moments.length} moment${structure.moments.length === 1 ? '' : 's'}; choose one of those ranks or pass sourceTime.`);
      const start = chosen ? chosen.time : nearestDownbeat(map, input.sourceTime!);
      const bars = structure.bars, first = bars.findIndex(bar => Math.abs(bar.start - start) < 1e-3);
      const songEnd = asset.duration ?? start + clip.duration * rate;
      let end: number, count: number | undefined;
      if (input.length !== undefined) {
        count = barsForLength(input.length * rate, structure.barSeconds);
        end = first >= 0 && bars[first + count - 1] ? bars[first + count - 1].end : start + count * structure.barSeconds;
        if (end > songEnd + 1e-3) throw new Error(`From ${start} s the song has ${Math.round((songEnd - start) * 10) / 10} s left, less than ${count} bars. Pick an earlier moment or a shorter length.`);
      } else end = Math.min(songEnd, start + clip.duration * rate);
      const duration = (end - start) / rate;
      const result = await checkpoint(t => {
        // Move first: the new length may only fit at the requested place.
        const moved = input.at !== undefined ? moveClipTo(t, clip.id, input.at) : t;
        return trimClip(moved, clip.id, duration, start);
      });
      const placed = find(editSession.timeline, clip.id);
      return { ...result, clipId: clip.id, sourceStart: start, sourceEnd: Math.round(end * 1000) / 1000, timelineStart: placed.start, timelineEnd: Math.round((placed.start + placed.duration) * 1000) / 1000,
        startsOn: chosen ? `moment ${chosen.rank} (bar ${chosen.bar}): ${chosen.why}` : `the downbeat at ${start} s${Math.abs(start - input.sourceTime!) > 1e-3 ? ` (nearest to ${input.sourceTime} s)` : ''}`,
        endsOn: count === undefined ? 'the clip keeps its length; it may not end on a bar line' : `${count} bars later${count % 4 === 0 ? `, the end of its ${count}-bar phrase` : ''}`,
        check: { tool: 'getSound', arguments: { start: Math.max(0, placed.start - 2), end: placed.start + 4 } } };
    } }),
    setAudioReactive: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setAudioReactive, description: "Make clips react to music: a level from one song's beats (mode beats, downbeats or accents; instant attack, decay release) or its loudness (energy, with sensitivity) drives up to 4 targets per clip: scale, shake or rotate on any clip, or a keyframeable effect control (e.g. colorGrade.exposure, glitch.intensity) on video/image. amount is added at full level and is 0 in silence. Covers each clip's own span, up to 4 minutes; clear:true removes it. Typical amounts: readSkill footage-editing page effect-tools.", inputSchema: z.object({ clipIds: clipIdsInput, musicClipId: z.string().min(1).optional().describe('The audio clip whose sound drives the reaction; omit when clear'), mode: z.enum(['beats', 'downbeats', 'accents', 'energy']).optional(), targets: z.array(z.object({ property: z.string().min(1).max(60).describe(`${CSS_REACTIVE_TARGETS.join(', ')} or group.control`), amount: z.number() }).strict()).min(1).max(4).optional(), sensitivity: z.number().min(0).max(1).optional(), decay: z.number().min(.03).max(1.5).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => {
      if (input.clear) return checkpoint(t => { let next = t; for (const id of input.clipIds) next = patchClip(next, find(next, id).id, { audioReactive: undefined }); return next; });
      if (!input.musicClipId || !input.targets) throw new Error('Give musicClipId and targets, or clear:true.');
      for (const target of input.targets) { const range = reactiveAmountRange(target.property); if (!range) throw new Error(`${target.property} cannot react to audio. Use ${CSS_REACTIVE_TARGETS.join(', ')} or an effect control such as glitch.intensity.`); if (target.amount < range[0] || target.amount > range[1]) throw new Error(`${target.property} amount must be between ${range[0]} and ${range[1]}.`); }
      await editSession.wait();
      let music = find(editSession.timeline, input.musicClipId);
      // A video's sound lives on its linked audio clip.
      if (music.kind === 'video' && music.linkedClipId) music = find(editSession.timeline, music.linkedClipId);
      if (music.kind !== 'audio' || !music.assetId) throw new Error('Choose the song’s audio clip as musicClipId.');
      const mode = input.mode ?? 'beats', decay = input.decay ?? (mode === 'energy' ? .12 : .22);
      let asset = await loadAsset(music.assetId);
      let sampleAt: ((time: number) => number | undefined) | undefined, hits: { time: number; strength: number }[] = [];
      const musicEnd = music.start + music.duration;
      if (mode === 'energy') {
        if (!asset.waveform) throw new Error('This audio’s waveform is still being measured. Try again shortly.');
        const peaks = decodeLevels(asset.waveform.peaks), rate = asset.waveform.samplesPerSecond;
        sampleAt = time => { if (time < music.start || time >= musicEnd) return undefined; const index = Math.floor(sourceTimeAt(music, time) * rate); return index >= 0 && index < peaks.length ? peaks[index] / 255 : undefined; };
      } else {
        const kind = mode === 'downbeats' ? 'downbeats' : mode === 'accents' ? 'accents' : 'beats';
        if (asset.analysis?.beats?.engine !== BEAT_ANALYSIS_ENGINE || asset.analysis.beats[kind] === undefined) asset = await analyze(asset._id, 'beats');
        const map = asset.analysis?.beats;
        const raw = kind === 'accents' ? map?.accents ?? [] : (kind === 'downbeats' ? map?.downbeats ?? [] : map?.beats ?? []).map(time => ({ time, strength: kind === 'beats' && map?.downbeats?.some(down => Math.abs(down - time) < .03) ? 1 : kind === 'beats' ? .75 : 1 }));
        hits = raw.map(hit => ({ time: timelineTimeAtSource(music, hit.time), strength: Math.min(1, Math.max(.2, hit.strength)) })).filter(hit => hit.time >= music.start - 1e-6 && hit.time < musicEnd);
        if (!hits.length) throw new Error(`No ${kind} were detected in this song's clip.`);
      }
      const reacted: { clipId: string; peaks: number }[] = [];
      const saved = await checkpoint(t => {
        let next = t;
        for (const id of input.clipIds) {
          const clip = find(next, id), start = clip.start, end = clip.start + clip.duration;
          if (end - start > MAX_REACTIVE_SAMPLES / REACTIVE_RATE) throw new Error(`Clip ${id} is longer than ${MAX_REACTIVE_SAMPLES / REACTIVE_RATE / 60} minutes. Split it first.`);
          const values = sampleAt ? energyLevels(sampleAt, start, end, input.sensitivity ?? .6, decay) : pulseLevels(hits, start, end, decay);
          reacted.push({ clipId: id, peaks: hits.filter(hit => hit.time >= start && hit.time < end).length });
          next = patchClip(next, clip.id, { audioReactive: { rate: REACTIVE_RATE, start, levels: encodeLevels(values), targets: input.targets! } });
        }
        return next;
      });
      return { ...saved, mode, reacted: mode === 'energy' ? reacted.map(item => item.clipId) : reacted };
    } }),
    addMarker:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addMarker,description:"Add an explicitly requested ordinary timeline cue at user-provided seconds, snapped to project frames, with an optional user-provided label. Preserve clips and existing cues; a frame that already has a cue adds no duplicate. This does not analyze audio or claim a measured beat/hit. For measured musical markers use markMusicBeats instead.",inputSchema:z.object({time:z.number().min(0),label:z.string().min(1).max(120).optional()}),execute:async(_ctx,{time,label})=>checkpoint(t=>addTimelineMarker(t,time,crypto.randomUUID(),label??null))}),
    moveMarker:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.moveMarker,description:"Move one existing ordinary or measured cue by exact markerId from inspectTimeline to explicitly requested timeline seconds, snapped to frames. Preserve its ID/label and every other cue/clip. This manual move does not analyze music or assert a new measured beat.",inputSchema:z.object({markerId:z.string().min(1).max(100),time:z.number().min(0)}),execute:async(_ctx,{markerId,time})=>checkpoint(t=>{if(!t.markers?.some(marker=>marker.id===markerId))throw new Error('Choose an existing timeline marker ID.');return moveTimelineMarker(t,markerId,time)})}),
    removeMarker: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.removeMarker, description: "Remove one orange timeline marker using its exact marker ID from inspectTimeline. Leaves all clips and other markers unchanged; works even when the marker has no label. An already absent ID makes no change. Returns actual removedMarkerIds and removed count.", inputSchema: z.object({ markerId: z.string().min(1).max(100) }), execute: async (_ctx, input) => markerCheckpoint(t => removeTimelineMarker(t, input.markerId)) }),
    removeMarkers: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.removeMarkers, description: "Remove orange timeline markers without touching clips. Choose scope all only when asked to remove or clear all markers; choose selected with exact markerIds from inspectTimeline for a specific set. Labels are optional, so use IDs. Returns actual removedMarkerIds and removed count, including zero when no markers matched.", inputSchema: z.object({ scope: z.enum(['all', 'selected']), markerIds: z.array(z.string().min(1).max(100)).min(1).max(1000).optional() }).refine(input => input.scope === 'selected' ? input.markerIds !== undefined : input.markerIds === undefined, { message: 'Use selected with markerIds, or all without markerIds.' }), execute: async (_ctx, input) => markerCheckpoint(t => removeTimelineMarkers(t, input.scope === 'all' ? undefined : input.markerIds)) }),
    matchMusic: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.matchMusic, description: "Give an edit music that matches a reference video's, never its own audio. Measures the reference video's tempo, beat grid and energy curve, then picks the closest Mixkit library track (open license, measured BPM, genre and energy) by tempo and feel, and places it so its downbeats land on the reference's downbeats (or on the main moments you pass), starting at the stretch of the track whose energy follows the reference's, nudged up to 8% in speed (pitch kept) to lock the tempo. The track is copied into the project with its beat map, so alignCutsToBeat with the returned musicAssetId works right away; the clip name carries the credit. When no track is within reach, it renders a synthesized bed at the reference's tempo instead.", inputSchema: z.object({ referenceAssetId: z.string().describe('The reference video (or its audio) from getProject.'), moments: z.array(z.number().min(0)).max(40).optional().describe("The edit's main moments in reference SOURCE seconds (its big hits). Default: the reference's own downbeats."), at: z.number().min(0).optional().describe('Timeline seconds where the edit starts (default 0).'), referenceStart: z.number().min(0).optional().describe('The reference second the edit starts at, when it follows an excerpt (default 0).'), duration: z.number().positive().max(MUSIC_BED_LIMITS.duration).optional().describe('Music length in seconds; default: to the end of the visuals on the timeline.'), style: z.string().max(80).optional().describe('Genre or mood words heard or wanted (house, lo-fi, funk, uplifting, chill...), matched against track genres and tags.'), trackId: z.string().optional().describe('A library track id (mixkit-…) to use instead of the best match, e.g. one of the alternatives from an earlier call.'), synth: z.boolean().optional().describe('Render a synthesized bed instead of a library track.'), feel: z.enum(['calm', 'warm', 'upbeat', 'driving']).optional().describe("Override the measured feel."), gain: z.number().min(0).max(1.2).optional().describe('Clip volume (default 0.45, under the motion sounds).') }), execute: async (_ctx, input) => {
      let reference = await loadAsset(input.referenceAssetId);
      if (reference.kind !== 'video' && reference.kind !== 'audio') throw new Error('Choose the reference video or its audio.');
      const source = reference.kind === 'video' && reference.audioAssetId ? await loadAsset(reference.audioAssetId) : reference;
      reference = source.analysis?.beats?.engine === BEAT_ANALYSIS_ENGINE ? source : await analyze(source._id, 'beats');
      const beats = reference.analysis?.beats;
      if (!beats || beats.beats.length < 8) throw new Error('The reference has too few clear beats to match its tempo. Pick a track by ear (trackId) or a synthesized bed with a feel.');
      const grid = beatGrid(beats), at = input.at ?? 0;
      await editSession.wait();
      const visualEnd = Math.max(0, ...editSession.timeline.clips.filter(clip => clip.kind !== 'audio' && clip.kind !== 'effect').map(clip => clip.start + clip.duration));
      const duration = Math.min(MUSIC_BED_LIMITS.duration, input.duration ?? (visualEnd > at ? visualEnd - at : (reference.duration ?? 30)));
      // The first downbeat to land on, in film seconds: on the main moments, or the reference's own, shifted when the film is an excerpt.
      const from = input.referenceStart ?? 0, referencePhase = input.moments?.length ? phaseForMoments(input.moments, grid.period) : grid.phase;
      const phase = (((referencePhase - from) % grid.bar) + grid.bar) % grid.bar;
      const whole = reference.waveform ? energyCurve(reference.waveform, reference.duration ?? duration, 1) : undefined;
      const curve = whole && { ...whole, values: whole.values.slice(Math.floor(from)) };
      const feel = input.feel ?? feelOf(grid.bpm, curve?.values ?? []);
      const picks = input.synth ? [] : rankStockMusic({ bpm: grid.bpm, energy: curve?.values ?? [], level: curve?.level, style: input.style, trackId: input.trackId });
      if (input.trackId && !picks.length) throw new Error(`No library track ${input.trackId}.`);
      const pick = picks[0] && (input.trackId || picks[0].fits) ? picks[0] : undefined;
      const gain = input.gain ?? .45, clipId = crypto.randomUUID();
      let asset: (typeof assets)[number], placement: { sourceStart: number; rate: number }, credit: string | undefined;
      if (pick) {
        const track = pick.track;
        placement = placeStockMusic(track, pick.rate, phase, duration, curve?.values ?? []);
        asset = assets.find(item => item.fileName === stockMusicFileName(track)) ?? await (async () => {
          const response = await fetch(track.url, { headers: { referer: MIXKIT_REFERER, 'user-agent': 'Mozilla/5.0 (Revline)' }, signal: AbortSignal.any([abortSignal, AbortSignal.timeout(60_000)]) });
          if (!response.ok) throw new Error(`Mixkit did not return ${track.title} (${response.status}). Try another trackId or synth:true.`);
          const bytes = new Uint8Array(await response.arrayBuffer()), key = newProjectMediaKey(run.ownerId, run.projectId);
          const size = await putMediaObject(key, bytes, 'audio/mpeg');
          try {
            const saved = await ctx.runMutation(internal.assistant.saveGeneratedSound, { ...run, r2Key: key, fileName: stockMusicFileName(track), contentType: 'audio/mpeg', size, duration: track.duration, waveform: track.waveform, beats: { beats: track.beats, bpm: track.bpm, confidence: track.confidence, engine: BEAT_ANALYSIS_ENGINE, downbeats: track.downbeats, accents: track.accents, dropCandidates: [] } });
            assets.push(saved);
            return saved;
          } catch (error) { await storageControl({ action: 'delete', key }).catch(() => {}); throw error; }
        })();
        credit = `"${track.title}" by ${track.artist}, Mixkit (${MIXKIT_LICENSE.name})`;
      } else {
        // Nothing in the library is close enough: a bed rendered at the reference's tempo, downbeats on its grid.
        const firstBar = Math.floor(-phase / grid.bar);
        const perBar = reference.waveform ? energyCurve(reference.waveform, Math.max(reference.duration ?? duration, duration), grid.bar, from + phase + firstBar * grid.bar).values : undefined;
        const bed = renderMusicBed({ duration, bpm: grid.bpm, feel, phase, energy: perBar });
        const key = newProjectMediaKey(run.ownerId, run.projectId), size = await putMediaObject(key, encodeWav(bed.samples), 'audio/wav');
        try { asset = await ctx.runMutation(internal.assistant.saveGeneratedSound, { ...run, r2Key: key, fileName: `Music bed ${Math.round(bed.bpm)} BPM ${feel}.wav`, size, duration: bed.samples[0].length / SR, waveform: soundWaveform(bed.samples), beats: { beats: bed.beats, bpm: bed.bpm, confidence: 1, engine: BEAT_ANALYSIS_ENGINE, downbeats: bed.downbeats, accents: [], dropCandidates: [], energy: bedEnergy(bed.samples) } }); }
        catch (error) { await storageControl({ action: 'delete', key }).catch(() => {}); throw error; }
        assets.push(asset);
        placement = { sourceStart: 0, rate: 1 };
      }
      const result = await checkpoint(t => {
        const start = Math.round(at * t.fps) / t.fps, length = Math.min(duration, (asset.duration! - placement.sourceStart) / placement.rate), end = start + length;
        const busy = new Set(t.clips.filter(clip => clip.kind === 'audio' && clip.start < end && start < clip.start + clip.duration).map(trackOf));
        let track = 1; while (busy.has(track) && track < maxTrackCount('audio')) track++;
        let next = addMediaClip(t, { _id: asset._id, kind: 'audio', duration: asset.duration! }, clipId, start, track);
        next = patchClip(next, clipId, { sourceStart: placement.sourceStart, duration: length * placement.rate, volume: gain });
        if (placement.rate !== 1) next = setClipPlaybackRate(next, clipId, placement.rate);
        return configureAudio(next, clipId, { role: 'music', fadeIn: placement.sourceStart > 0 ? .25 : 0, fadeOut: Math.min(1.5, length / 6) });
      });
      const moments = input.moments ?? beats.downbeats?.slice(0, 8) ?? [];
      return { ...result, clipId, musicAssetId: asset._id, ...(pick ? { track: { id: pick.track.id, title: pick.track.title, artist: pick.track.artist, genre: pick.track.genre, bpm: pick.track.bpm, score: pick.score }, credit, sourceStart: placement.sourceStart, playbackRate: placement.rate } : { synthesized: true, feel }), referenceBpm: grid.bpm, referenceFeel: feel, alternatives: picks.slice(pick ? 1 : 0, (pick ? 1 : 0) + 3).map(item => ({ id: item.track.id, title: item.track.title, artist: item.track.artist, genre: item.track.genre, bpm: item.track.bpm, score: item.score })), momentFit: momentFit(moments.map(time => time - from).filter(time => time >= 0), grid.period, phase).map(item => ({ ...item, time: Math.round((at + item.time) * 1000) / 1000 })), note: `${pick ? 'Library track, chosen by measured tempo and energy; not listened to.' : 'Synthesized at the reference tempo because no library track was close; not listened to.'} Downbeats sit on the reference's (momentFit shows each moment's distance). alignCutsToBeat with this musicAssetId snaps their cuts. Keep generated effects 0.2 to 0.3 above it. Credit the track when sharing.` };
    } }),
    alignCutsToBeat: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.alignCutsToBeat, description: "Snap the cuts between consecutive V1 clips, and the end of the last one, to the nearest beats of this music source's beat map, keeping their order; use it for any cut or ending on the beat instead of resizing by hand. Needs a current beat map (analyzeMedia mode beats first if missing) and footage long enough for each moved cut. The music must be its own clip that stays put: when the music comes from the shots' own linked audio, place one continuous music clip and mute or unlink the shots' audio first.", inputSchema: z.object({ musicAssetId: z.string() }), execute: async (_ctx, input) => savedCheckpoint(input.musicAssetId,t => {
      const music = assets.find(a => a._id === input.musicAssetId); const map = music?.analysis?.beats; const beats = map?.beats;
      if (map?.engine !== BEAT_ANALYSIS_ENGINE || !beats?.length) throw new Error("Run Find beats on this source first; no current dedicated beat map is saved");
      return alignCutsToBeats(t, assets.map(asset => ({ ...asset, url: null })), input.musicAssetId, beats);
    }) }),
    useStrongestMoment: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.useStrongestMoment, description: "Use the highest-scored scene from a saved footage understanding result. Replace this source's first video shot, or append a shot if it has not been used. When scenes are unavailable, returns a hint to choose an evidenced range with readFrames and transcript tools instead. Never guess a source moment.", inputSchema: z.object({ assetId: z.string() }), execute: async (_ctx, input) => {
      const asset = await loadAsset(input.assetId), scenes = asset.analysis?.understanding?.scenes;
      if (asset.kind !== "video") throw new Error("Choose a video source");
      if (!scenes?.length) return { ...understandingUnavailable(input.assetId), applied: false };
      return checkpoint(t => {
        const scene = scenes.reduce((strongest, current) => current.score > strongest.score ? current : strongest);
        const range = shotAlignedRange(scene, asset.analysis?.shots);
        const existing = t.clips.find(clip => clip.kind === "video" && clip.assetId === input.assetId);
        const start = existing?.start ?? timelineDuration(t);
        const duration = Math.min(range.end - range.start, (asset.duration ?? range.end) - range.start) / (existing ? playbackRateOf(existing) : 1);
        if (duration < 1 / t.fps) throw new Error("The strongest scene is shorter than one frame");
        const id = existing?.id ?? crypto.randomUUID();
        const next = existing ? t : addMediaClip(t, { ...asset, duration }, id, start);
        const shot = find(next, id);
        return placeOnFreeLayer(next, { ...shot, sourceStart: range.start, duration, focus: asset.analysis?.focus ? focusForClip(asset.analysis.focus, { ...shot, sourceStart: range.start, duration }) : undefined });
      });
    } }),
    inspectAssetAnalysis: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.inspectAssetAnalysis, description: "Read this media's saved transcript, scene descriptions, measured shot boundaries, audio quiet intervals, tracking, beats and speaker analysis. Start here for footage with speech: the transcript decides the cut and where b-roll, images and overlays go, before any frame read. transcriptOnly:true returns only transcript evidence; start/end, or up to eight windows (each up to 30 s, all in ONE call), return exact word timings. Scene understanding may be absent: use the transcript and readFrames instead of waiting or retrying. Audio energy is not proof of silence or a visual observation. Speaker and face IDs in a window are local to it. Never invent results.", inputSchema: z.object({ assetId: z.string(), start: z.number().min(0).optional(), end: z.number().positive().optional(), windows: z.array(z.object({ start: z.number().min(0), end: z.number().positive() })).min(1).max(8).optional(), transcriptOnly: z.boolean().optional() }).refine(input => (input.start === undefined && input.end === undefined) || (input.start !== undefined && input.end !== undefined && input.end > input.start), { message: 'Provide a valid start/end SOURCE range together.' }), execute: async (_ctx, input) => {
      let asset = await loadAsset(input.assetId);
      // Transcripts made before windowed transcription merged repeated takes
      // and dropped speech. Refresh one before the model plans cuts from it;
      // a failed refresh is not retried by every later read in this run.
      if (asset.analysis?.transcript && !currentTranscript(asset.analysis.transcript) && !transcriptRefreshFailures.has(asset._id)) {
        try { asset = await analyze(asset._id, 'transcribe'); }
        catch (error) { transcriptRefreshFailures.set(asset._id, error instanceof Error ? error.message : 'unknown error'); }
      }
      const transcriptNote = asset.analysis?.transcript && !currentTranscript(asset.analysis.transcript) ? `This transcript predates current transcription and may merge repeated takes or miss speech${transcriptRefreshFailures.has(asset._id) ? `; refreshing it failed (${transcriptRefreshFailures.get(asset._id)})` : ''}. Treat lines missing from it as unverified, not absent, and ask the user rather than watching the footage to find them.` : undefined;
      if (!asset.analysis) return { assetId: asset._id, unavailable: true, understandingNote: OPTIONAL_UNDERSTANDING_NOTE };
      const evidence = input.transcriptOnly ? { transcript: asset.analysis.transcript } : asset.analysis;
      const read = input.windows ? modelAssetAnalysisWindows(evidence, input.windows) : modelAssetAnalysis(evidence, input.start !== undefined && input.end !== undefined ? { start: input.start, end: input.end } : undefined);
      return { assetId: asset._id, ...read, ...(transcriptNote ? { transcriptNote } : {}) };
    } }),
    closeGaps: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.closeGaps, description: "Join footage after cuts: ONE call with no arguments closes EVERY gap between video/image clips on the main footage layer, including sub-frame gaps, moving later clips earlier with their sound (linked, or the unlinked audio of the same take under them), and puts each footage piece's own sound back in sync with its picture and on its in/out; captions follow their spoken words. Never go gap by gap; to merge two pieces of one take into one clip use joinClips. track joins one other V layer, allLayers:true packs every visual layer, clipIds (two or more) limits it to the gaps between those clips. Overlays, b-roll and other layers stay where they are (ripple them with moveClips). Returns closedGaps and remainingGaps.", inputSchema: z.object({ clipIds: clipIdsInput.optional(), track: z.number().int().min(1).max(24).optional().describe('Join this V layer instead of the main footage layer.'), allLayers: z.boolean().optional().describe('Pack every visual layer that holds footage. Overlays placed by time lose their positions.') }), execute: async (_ctx, input) => {
      let before: ReturnType<typeof footageGaps> = [], tracks: number[] | undefined, realigned: string[] = [];
      const result = await checkpoint(t => { const main = mainFootageTrack(t); tracks = input.allLayers || input.clipIds ? undefined : [input.track ?? main ?? 1]; before = footageGaps(t); const audioAssetOf = (assetId: string) => assets.find(asset => asset._id === assetId)?.audioAssetId; const aligned = alignSounds(closeFootageGaps(t, input.clipIds ?? [], tracks, audioAssetOf), audioAssetOf); realigned = aligned.aligned; return aligned.timeline; });
      const joined = (gap: { track: number }) => !tracks || tracks.includes(gap.track);
      const remaining = footageGaps(editSession.timeline).filter(joined), closed = before.filter(gap => joined(gap) && !remaining.some(left => left.beforeClipId === gap.beforeClipId && left.track === gap.track));
      const round = (value: number) => Math.round(value * 1000) / 1000;
      return { ...result, ...(tracks ? { joinedLayers: tracks.map(track => `V${track}`) } : {}), ...(realigned.length ? { realignedSound: realigned } : {}), closedGaps: closed.length, ...(closed.length ? { closed: closed.slice(0, 50).map(gap => ({ start: round(gap.start), end: round(gap.end), track: gap.track, beforeClipId: gap.beforeClipId })) } : {}), remainingGaps: remaining.length, ...(remaining.length ? { remaining: remaining.slice(0, 50).map(gap => ({ start: round(gap.start), end: round(gap.end), track: gap.track, beforeClipId: gap.beforeClipId })), next: input.clipIds ? 'Gaps outside the chosen clips remain. Call closeGaps with no arguments to close them all.' : 'These gaps remain.' } : {}) };
    } }),
    retainSourceRanges: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.retainSourceRanges, description: "Keep ordered SOURCE-time ranges of one existing video/audio clip and compact them at its timeline start in ONE change; linked audio, speed and styling stay, and other clips keep their positions (no ripple). Any speech cut passes tightenSilence:true: pauses, breaths and fillers inside the kept ranges go and edges snap to word sound (report its speechCleanup summary); keepPauses:true only when the user asks; omit tightenSilence for exact user timestamps. Ranges are clamped to this clip plus the adjacent pieces of the same source on its track, so a cut is redone in one call on any piece: a range that spills into footage an earlier cut removed keeps only what is retained (clampedRanges reports what was applied), and only a range with no retained footage inside is refused; it never restores removed footage (restoreClip first). Pieces under 2 frames are dropped (droppedSlivers). Refuses transition-connected sources. After a speech cut call readCutScript, and add opening clips, b-roll and overlays only after cutting.", inputSchema: z.object({ clipId: z.string().min(1).max(100), ranges: z.array(z.object({ start: z.number().min(0), end: z.number().positive() }).strict()).min(1).max(100), tightenSilence: z.boolean().optional(), keepPauses: z.boolean().optional(), exactEdges: z.boolean().optional() }), execute: async (_ctx, input) => {
      let evidence: (typeof assets)[number] | undefined;
      if (input.tightenSilence) {
        const speech = await speechEvidence(input.clipId);
        if (speech.cleanup) {
          // Validate the request as asked before measured adjustment; ranges spilling past the retained source are clamped to it.
          const { clamped } = retainSourceRanges(editSession.timeline, input.clipId, input.ranges, undefined, true);
          const cut = await applySpeechCut(input.clipId, speech, input.ranges, input.keepPauses ? new Set() : new Set(['pause', 'breath', 'filler']), .6);
          return { ...cut, ...clampReport(clamped) };
        }
        evidence = speech.evidence;
      }
      let ranges: RetainedRangeSummary[] = [], droppedRanges: { start: number; end: number }[] = [], clamped: RetainedRangeClamp[] = [];
      let tightened = false;
      const result = await checkpoint(t => {
        // Validate the original request before any measured adjustment.
        let retained = retainSourceRanges(t, input.clipId, input.ranges, undefined, input.exactEdges);
        clamped = retained.clamped;
        if (evidence?.analysis?.transcript && evidence.analysis.audioActivity) {
          const clip = find(t, input.clipId), pair = t.clips.find(member => member.id === clip.linkedClipId && member.assetId === evidence._id);
          const offset = clip.assetId === evidence._id ? 0 : pair ? pair.sourceStart - clip.sourceStart : undefined;
          if (offset === undefined) throw new Error('The audio evidence no longer matches this linked source.');
          const refined = input.ranges.map(range => {
            const measured = refineAudioRangeEdges({ start: range.start + offset, end: range.end + offset }, evidence!.analysis!.transcript!, evidence!.analysis!.audioActivity!);
            const next = { start: Math.max(range.start, measured.start - offset), end: Math.min(range.end, measured.end - offset) };
            return (next.end - next.start) / playbackRateOf(clip) >= 1 / t.fps - 1e-7 ? next : range;
          });
          tightened = refined.some((range, index) => range.start !== input.ranges[index].start || range.end !== input.ranges[index].end);
          if (tightened) retained = retainSourceRanges(t, input.clipId, refined, undefined, input.exactEdges);
        }
        ranges = retained.ranges; droppedRanges = retained.dropped; return retained.timeline;
      });
      return { ...result, retainedRanges: ranges, ...clampReport(clamped), ...(droppedRanges.length ? { droppedSlivers: droppedRanges.map(range => ({ sourceStart: Math.round(range.start * 1000) / 1000, sourceEnd: Math.round(range.end * 1000) / 1000 })), sliverNote: `Dropped ${droppedRanges.length} piece${droppedRanges.length === 1 ? '' : 's'} shorter than ${MIN_CUT_FRAMES} frames: a cut never leaves a piece that short.` } : {}), ...(evidence ? { silenceRefinement: { status: tightened ? 'applied' : evidence.analysis?.audioActivity?.reliable ? 'unchanged' : 'unreliable', evidenceAssetId: evidence._id, paddingSeconds: AUDIO_QUIET_EDGE_PAD } } : {}) };
    } }),
    readScript: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.readScript, description: "Start here for footage with speech in the reel lane, before any cut, frame read or added media: read the whole take as a script. Returns every spoken line numbered with SOURCE times, marked [chatter] (setup or wrap-up talk around the script) or [earlier take of Ln] (the line is said again later; the last complete take is kept), the suggested opening line (the first intended line, after setup talk and restarted attempts) and closing line (the last intended line, before 'cut' and trailing talk), the length if every script line is kept, and the length the user asked for. The marks are measured suggestions: you decide what the piece is about and its beats, then call planScript. Reads saved transcript data; nothing is edited.", inputSchema: z.object({ clipId: z.string().min(1).max(100) }).strict(), execute: async (_ctx, input) => {
      const speech = await speechEvidence(input.clipId), transcript = speech.evidence.analysis?.transcript;
      // Footage without speech has no script to hold a cut to: the script-first gate lifts for this request.
      if (!transcript?.words.length) { noScript = true; throw new Error('This clip has no spoken words, so there is no script to read. Edit it as footage: cut it directly.'); }
      const spans = retainedSpans(speech), outline = scriptOutline(transcript, spans);
      if (!outline.lines.length) { noScript = true; throw new Error('No spoken words are left in this clip’s retained source. Edit it as footage.'); }
      const line = (n: number) => outline.lines[n - 1], opening = line(outline.opening), closing = line(outline.closing);
      const script = outline.lines.filter(item => !item.note).map(item => item.n);
      const task = await readTask(), target = task?.requestedLength;
      const estimate = await scriptSeconds(input.clipId, speech, linesToRanges(outline, script).map(range => ({ start: range.start - speech.offset, end: range.end - speech.offset })));
      const takes = outline.lines.filter(item => item.note === 'earlier take').length + outline.removable.filter(cut => script.some(n => cut.start >= line(n).start && cut.end <= line(n).end + .01)).length;
      // B-roll: shots with no speaker in frame are footage, never "silence". One frame of each goes to the model.
      const policy = LANES.reel.eyes!, source = { start: spans[0].start, end: spans.at(-1)!.end };
      let shots: Range[] = [], brollNote: string | undefined, images: { label: string; data: string; mimeType: string }[] = [], frames: string | undefined;
      try {
        const found = await findBroll(speech.evidence, source); shots = found.shots; brollNote = found.note;
        if (shots.length && !found.unavailable) {
          const { budget, save } = await frameBudget(policy.frames.total), shown = shots.slice(0, Math.min(policy.frames.broll, budget.left));
          if (shown.length) {
            const strip = (await runLooksRead(ctx, run.ownerId, run.projectId, speech.evidence._id, shown.map(shot => Math.round((shot.start + shot.end) / 2 * 100) / 100), shown.length, abortSignal)).strips[0];
            if (strip) { budget.take(shown.length); await save(); images = [{ label: `B-roll shots, one frame each, in order: ${shown.map(shot => `${(shot.start - speech.offset).toFixed(1)}-${(shot.end - speech.offset).toFixed(1)} s`).join(', ')}`, data: strip, mimeType: 'image/jpeg' }]; }
          }
          frames = budget.report();
        }
      } catch (error) { if (abortSignal.aborted) throw error; brollNote = `${brollNote ? `${brollNote} ` : ''}The b-roll frames could not be shown (${error instanceof Error ? error.message : 'unavailable'}).`; }
      const broll = shots.map(shot => { const over = outline.lines.filter(item => !item.note && item.end > shot.start && item.start < shot.end).map(item => item.n); return { sourceStart: Math.round((shot.start - speech.offset) * 100) / 100, sourceEnd: Math.round((shot.end - speech.offset) * 100) / 100, ...(over.length ? { overLines: over, use: 'cutaway the user placed over these lines; it stays with them' } : { use: 'shot between lines; kept in place by planScript' }) }; });
      const words = (text: string, tail = false) => { const parts = text.split(/\s+/); return parts.length <= 6 ? text : tail ? parts.slice(-6).join(' ') : parts.slice(0, 6).join(' '); };
      const asked = target ? target.min !== undefined && target.max !== undefined ? `${target.min}-${target.max} s` : target.max !== undefined ? `at most ${target.max} s` : `at least ${target.min} s` : undefined;
      return { clipId: input.clipId, assetId: speech.evidence._id, lineCount: outline.lines.length, lines: outlineLines(outline),
        suggested: { opening: { line: opening.n, sourceStart: opening.start - speech.offset, text: opening.text }, closing: { line: closing.n, sourceEnd: closing.end - speech.offset, text: closing.text }, earlierTakes: outline.lines.filter(item => item.note === 'earlier take').map(item => ({ line: item.n, keptTake: item.takeOf ?? null })), chatterLines: outline.lines.filter(item => item.note === 'chatter').map(item => item.n), stumblesRemoved: outline.removable.length },
        ...(outline.candidates ? { twoOpenings: outline.candidates.map(n => ({ line: n, text: line(n).text })), ask: 'Two different complete openings were recorded. Unless the request already says which, ask the user with askUser, using these two lines as the options.' } : {}),
        ...(broll.length ? { broll, brollRule: 'These shots show something other than the speaker. They are footage, not silence or non-speech: never cut them out to tighten. Describe each in one line from its frame when you report.', ...(frames ? { frames } : {}) } : {}), ...(brollNote ? { brollNote } : {}),
        secondsIfWholeScriptKept: estimate.seconds, ...(target ? { requestedLength: target, ...(target.max !== undefined && estimate.seconds > target.max ? { overBy: Math.round((estimate.seconds - target.max) * 10) / 10 } : {}) } : {}),
        restatement: `I'll keep your script from "${words(opening.text)}" to "${words(closing.text, true)}", remove ${takes} false start${takes === 1 ? '' : 's'}${asked ? `, target ${asked}` : ''}.`,
        next: `Understand the piece, then call planScript with about (one line) and beats covering every script line from L${opening.n} to L${closing.n} in order: role hook, point, tangent, payoff or cta, and priority 1 (must keep) to 3 (first to drop). ${target?.max !== undefined && estimate.seconds > target.max ? `It is ${(estimate.seconds - target.max).toFixed(1)} s over the requested length: mark whole tangents and weaker points keep:false, never the opening or the payoff. ` : 'Keep every beat unless the user asked for a shorter cut. '}In the same step, tell the user the restatement in one line (adjust it if you choose differently). Do not cut before planScript returns its ranges.`, images };
    }, toModelOutput: (ctx, options) => labeledImages(ctx, options.output) }),
    planScript: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.planScript, description: "Reel lane, after readScript and before any cut, b-roll, image or overlay: save your plan of the take and get the exact ranges to keep. about: one line on what it says. beats: the script in order, each {role, from, to, priority} over readScript line numbers, covering every line; chatter and earlier takes inside a beat drop out (keepLines forces one back). For a requested length set keep:false on whole lower-priority beats, never the opening, the payoff or part of a sentence. Start on the opening line and end on the closing line unless the user asked otherwise (openingReason, endingReason quote it). Returns saved:false with the problems, or the SOURCE ranges to pass unchanged to retainSourceRanges with tightenSilence:true.", inputSchema: z.object({ clipId: z.string().min(1).max(100), about: z.string().trim().min(3).max(240), beats: z.array(z.object({ role: z.enum(BEAT_ROLES), from: z.number().int().min(1), to: z.number().int().min(1), priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), keep: z.boolean().optional() }).strict()).min(1).max(40), opening: z.number().int().min(1).optional().describe('Line the reel starts on, when it is not the suggested opening: the user-chosen one of two openings.'), openingReason: z.string().trim().min(3).max(200).optional().describe('Only when the user asked to start somewhere other than the script opening: their words.'), endingReason: z.string().trim().min(3).max(200).optional().describe('Only when the user asked to end before the script closing line: their words.'), keepLines: z.array(z.number().int().min(1)).max(40).optional() }).strict(), execute: async (_ctx, input) => {
      if (!taskId) throw stepOrderGuard('Start a task first with startTask.');
      const speech = await speechEvidence(input.clipId), transcript = speech.evidence.analysis?.transcript;
      if (!transcript?.words.length) throw new Error('This clip has no saved transcript with spoken words to plan from.');
      const spans = retainedSpans(speech), outline = scriptOutline(transcript, spans);
      const { problems, kept } = resolveScriptPlan(outline, input);
      const retry = 'Fix these and call planScript again. Nothing was saved and nothing was cut.';
      if (problems.length) return { saved: false, problems, next: retry };
      const line = (n: number) => outline.lines[n - 1], toClip = (range: { start: number; end: number }) => ({ start: Math.round((range.start - speech.offset) * 1000) / 1000, end: Math.round((range.end - speech.offset) * 1000) / 1000 });
      // Wordless b-roll between kept lines stays where the user placed it, as its own range.
      let allShots: Range[] = [], brollUnavailable: string | undefined;
      try { const found = await findBroll(speech.evidence, { start: spans[0].start, end: spans.at(-1)!.end }); if (found.unavailable) brollUnavailable = found.note; allShots = found.shots.filter(shot => spans.some(span => shot.start >= span.start - .1 && shot.end <= span.end + .1)); } catch (error) { if (abortSignal.aborted) throw error; }
      const keptShots = keptBroll(outline, kept, allShots);
      // Each kept shot is its own range, so the line ranges around it are split at its edges.
      const withShots = (list: { start: number; end: number }[], shots: Range[]) => [...list.flatMap(range => { let pieces = [range]; for (const shot of shots) pieces = pieces.flatMap(piece => shot.end <= piece.start || shot.start >= piece.end ? [piece] : [{ start: piece.start, end: shot.start }, { start: shot.end, end: piece.end }]); return pieces; }), ...shots].filter(range => range.end - range.start > .04).sort((a, b) => a.start - b.start);
      const ranges = withShots(linesToRanges(outline, kept, input.keepLines), keptShots).map(toClip);
      savedScript = { ...(savedScript ?? {}), assetId: speech.evidence._id, broll: allShots.map(shot => ({ ...shot, kept: keptShots.includes(shot) })) } as SavedScript;
      const estimate = await scriptSeconds(input.clipId, speech, ranges);
      const task = await readTask(), target = task?.requestedLength;
      const first = kept[0], last = kept.at(-1)!;
      const beats = await Promise.all(input.beats.map(async (beat, index) => {
        const lines = kept.filter(n => n >= beat.from && n <= beat.to);
        const seconds = beat.keep === false || !lines.length ? 0 : (await scriptSeconds(input.clipId, speech, linesToRanges(outline, lines, input.keepLines).map(toClip))).seconds;
        return { index: index + 1, role: beat.role, lines: `L${beat.from}-L${beat.to}`, priority: beat.priority, kept: beat.keep !== false && lines.length > 0, seconds, droppable: beat.keep !== false && lines.length > 0 && !lines.includes(first) && !lines.includes(last) && beat.role !== 'hook' && beat.role !== 'payoff' };
      }));
      // Room for the short natural tail checkSpots may add; finish allows the requested length one frame of slack.
      const overBy = target?.max !== undefined && estimate.seconds > target.max - .4 ? estimate.seconds - target.max : 0;
      if (overBy && beats.some(beat => beat.droppable)) {
        const drop = beatsToDrop(beats, estimate.seconds, target!);
        return { saved: false, estimatedSeconds: estimate.seconds, requestedLength: target, beats: beats.map(({ droppable: _droppable, ...beat }) => beat),
          problems: [`This plan is about ${estimate.seconds.toFixed(1)} s; the user asked for at most ${target!.max} s.`],
          next: drop.length ? `Call planScript again with keep:false on beat${drop.length === 1 ? '' : 's'} ${drop.join(', ')} (lowest priority that fits). Keep the opening, the payoff and whole sentences.` : 'Call planScript again with keep:false on the lowest-priority beats that are not the opening or the payoff. When none is left to drop, the plan is saved as it is and you tell the user the actual length.' };
      }
      const underBy = target?.min !== undefined && estimate.seconds < target.min ? target.min - estimate.seconds : 0;
      if (underBy && input.beats.some(beat => beat.keep === false)) return { saved: false, estimatedSeconds: estimate.seconds, requestedLength: target, beats: beats.map(({ droppable: _droppable, ...beat }) => beat), problems: [`This plan is about ${estimate.seconds.toFixed(1)} s; the user asked for at least ${target!.min} s.`], next: 'Call planScript again keeping more beats (remove keep:false from the highest-priority dropped beat). Never pad or repeat lines.' };
      const takes = outline.lines.filter(item => item.note && !kept.includes(item.n) && item.n > first && item.n < last || item.note === 'earlier take' && item.n < first).length;
      const script: SavedScript = { version: 1, assetId: speech.evidence._id, clipId: input.clipId, about: input.about,
        opening: { line: first, start: lineSpeech(outline, line(first)).start, text: line(first).text }, closing: { line: last, end: lineSpeech(outline, line(last)).end, text: line(last).text }, spans,
        beats: input.beats.map(beat => ({ ...beat, text: line(beat.from).text.split(/\s+/).slice(0, 8).join(' ') })), keepLines: input.keepLines ?? [],
        ...(input.openingReason ? { openingReason: input.openingReason } : {}), ...(input.endingReason ? { endingReason: input.endingReason } : {}), ...(target ? { target } : {}), estimatedSeconds: estimate.seconds, removedTakes: takes, ...(allShots.length ? { broll: allShots.map(shot => ({ ...shot, kept: keptShots.includes(shot) })) } : {}) };
      await laneCtx.runMutation(internal.lanes.saveScript, { ...taskScope, script });
      scriptSaved = true; savedScript = script;
      return { saved: true, about: input.about, opening: lineLabel(line(first)), closing: lineLabel(line(last)), removedTakesAndChatter: takes, droppedBeats: beats.filter(beat => !beat.kept).map(beat => `${beat.role} ${beat.lines}`), estimatedSeconds: estimate.seconds, estimate: estimate.measured ? 'measured speech cleanup applied' : 'upper bound; pauses not yet measured', ...(target ? { requestedLength: target } : {}),
        ...(overBy > 0 ? { note: `Opening and payoff alone are about ${estimate.seconds.toFixed(1)} s, over the requested ${target!.max} s, and nothing else can be dropped. Make this cut and tell the user the actual length; ask what else may go.` } : {}),
        ...(underBy ? { note: `The whole script is about ${estimate.seconds.toFixed(1)} s, under the requested ${target!.min} s. Keep it whole, never pad, and tell the user the actual length.` } : {}),
        ...(keptShots.length ? { brollKept: keptShots.map(toClip), brollNote: 'These b-roll shots are in the ranges as footage; the cut leaves them whole.' } : {}), ...(brollUnavailable ? { brollDetection: brollUnavailable } : {}),
        ranges, next: `Cut once from the full take: retainSourceRanges ${JSON.stringify({ clipId: input.clipId, ranges, tightenSilence: true })}. Pass these ranges unchanged. Then add captions and call finish.` };
    } }),
    readCutScript: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.readCutScript, description: "What the cut timeline now SAYS, as the viewer will hear it: prose, the surviving speech as one paragraph in timeline order, each sentence tagged [S<n> start–end] in TIMELINE seconds, plus hint flags (repeat, retake: a point said again in other words, clipped-word, mid-sentence, pause over 1.5 s), each with its id, time, clip and fix. Read the prose yourself like an editor: a reworded retake is a repeat the same as an exact one. Call it right after any speech cut and again after each fix, until the prose says each point once. remove:[ids] cuts flagged spots; drop:[{sentence, text?}] cuts what your reading finds: a whole sentence, or the exact words quoted from it (the later, complete version stays); both in one change, and the read comes back. accept:[{id, reason}] keeps a flag that is two different points or a repeat the speaker meant. heard: once a read of the cut as it is says each point once, call it alone with what the viewer hears in one line; a planned reel cannot finish without it. drop and heard need a read of the cut as it is now: when the cut changed since the last read, the call cuts nothing and returns the fresh read (refreshed says so), so act on its numbers in the next call. finish fails on unaccepted repeats, retakes and false starts (in a reel anywhere, elsewhere at a cut) and clipped words. Computed from saved word timings: instant, no listening or frames; it cannot hear what the transcript missed.", inputSchema: z.object({ remove: z.array(z.string().min(1).max(80)).max(50).optional().describe('Flag ids of repeats and false starts to cut out now, in one change.'), drop: z.array(z.object({ sentence: z.number().int().min(1), text: z.string().trim().min(1).max(400).optional().describe('Exact words of that sentence to cut, copied from the prose; omit to cut the whole sentence.') }).strict()).max(30).optional().describe('Sentences, or words quoted from them, that your reading of the prose finds said twice, abandoned or not making sense.'), accept: z.array(z.object({ id: z.string().min(1).max(80), reason: z.string().min(1).max(300) }).strict()).max(50).optional(), heard: z.string().trim().min(3).max(400).optional().describe('Your verdict after reading the prose of the cut as it is now: what the viewer hears, in one line ("each point said once", or what is still wrong). Not with remove or drop.'), maxPause: z.number().min(.3).max(10).optional() }).strict(), execute: async (_ctx, request) => {
      await editSession.wait();
      if (request.heard && (request.remove?.length || request.drop?.length)) throw new Error('heard is the verdict on the cut as it is now: cut first, read the new prose, then pass heard alone.');
      let input = request;
      await loadSavedSpeech();
      let removed: string[] | undefined, result: Awaited<ReturnType<typeof checkpoint>> | undefined, cutAway: { assetId: string; start: number; end: number }[] = [];
      const read = cutScript(editSession.timeline, assets, { maxPause: input.maxPause });
      // The last read of this cut: its accepted flags, and how many rounds of cutting it has had. A cut another tool changed
      // since is a new cut and starts again at round 0.
      const priorEntry = [...(await readTask())?.evidence ?? []].reverse().find(item => item.tool === 'readCutScript' && item.timelineId === timelineId);
      const priorRead = priorEntry?.output as { accepted?: Record<string, string>; rounds?: number; heard?: string; heardCut?: string; cutAway?: { assetId: string; start: number; end: number }[] } | undefined, unchanged = priorEntry?.fingerprint === await timelineHistoryKey(editSession.timeline);
      // Sentence numbers and heard belong to a read of the cut as it is now. When the cut changed since the last read (or it was
      // never read), nothing is cut: this call becomes that read, so the next call can act on fresh numbers without a separate read.
      const stale = (input.drop?.length || input.heard) && taskId && !unchanged ? { drop: !!input.drop?.length, heard: !!input.heard } : undefined;
      if (stale) input = { ...(input.accept ? { accept: input.accept } : {}), ...(input.maxPause !== undefined ? { maxPause: input.maxPause } : {}) };
      // Checked before anything is cut, so a refused call changes nothing.
      const unknown = (input.accept ?? []).filter(item => !read.flags.some(flag => flag.id === item.id));
      if (unknown.length) throw new Error(`No flag has the id ${unknown.map(item => item.id).join(', ')}. Use the ids from this result: ${read.flags.map(flag => flag.id).join(', ') || 'none are flagged'}.`);
      if (input.remove?.length || input.drop?.length) {
        const found = read.flags, flagged = (input.remove ?? []).map(id => { const flag = found.find(item => item.id === id); if (!flag?.remove) throw new Error(`${id} is not a removable flag. Removable now: ${found.filter(item => item.remove).map(item => item.id).join(', ') || 'none'}.`); return flag; });
        // A sentence or the words quoted from it, as the model's own reading of the prose found them.
        const dropped = (input.drop ?? []).map(item => ({ id: item.text ? `S${item.sentence} "${item.text}"` : `S${item.sentence}`, remove: cutWordsRemoval(read, item.sentence, item.text) }));
        const targets = [...flagged.map(flag => ({ id: flag.id, remove: flag.remove! })), ...dropped];
        // One cut per source: what is retained now, minus every flagged range. Measured edges stay exact.
        result = await checkpoint(t => {
          let next = t; const done = new Set<string>();
          cutAway = [];
          for (const cut of targets.flatMap(flag => flag.remove!)) {
            if (done.has(cut.clipId)) continue;
            const clip = find(next, cut.clipId);
            // After J/L cuts the sound stands alone: cutting it would leave the picture behind.
            if (clip.kind === 'audio' && !clip.linkedClipId && next.clips.some(item => item.kind === 'video' && item.audioSeparated)) throw new Error('Picture and sound of this take are unlinked by J/L cuts, so removing speech would put them out of sync. Undo the split edits (undoLatestEdit), remove the flags, then make the J/L cuts last.');
            const windows = retainedSourceWindows(next, cut.clipId), ids = new Set(windows.map(window => window.clipId));
            const cuts = targets.flatMap(flag => flag.remove!).filter(item => ids.has(item.clipId)).map(item => { const window = windows.find(piece => piece.clipId === item.clipId)!; return { start: Math.max(window.start, item.start), end: Math.min(window.end, item.end) }; }).sort((a, b) => a.start - b.start);
            ids.forEach(id => done.add(id));
            cutAway.push(...cuts.filter(item => item.end > item.start).map(item => ({ assetId: clip.assetId ?? "", start: Math.round(item.start * 1000) / 1000, end: Math.round(item.end * 1000) / 1000 })));
            const ranges = windows.flatMap(window => keptRanges(window.start, window.end, cuts.map(item => ({ kind: 'restart' as const, start: item.start, end: item.end, confidence: 1, detail: '' })))).filter(range => range.end - range.start >= .08);
            if (!ranges.length) throw new Error('Removing these would leave nothing of that clip. Remove fewer flags or delete the clip.');
            if (ranges.length > 100) throw new Error(`This take is in ${windows.length} pieces, more than one change can rebuild. Trim the flagged piece instead: ${targets.map(flag => flag.id).join(', ')}.`);
            next = retainSourceRanges(next, cut.clipId, ranges, undefined, true).timeline;
          }
          return next;
        });
        removed = targets.map(flag => flag.id);
      }
      const script = removed ? cutScript(editSession.timeline, assets, { maxPause: input.maxPause }) : read;
      if (!script.words.length) return { wordCount: 0, note: 'No saved transcript words are on this timeline. Transcribe the footage first (analyzeMedia transcribe), or edit it as footage without speech.' };
      const task = await readTask();
      // Only reads that cut count as rounds: accepting a flag or showing the user the script is free.
      const prior = priorRead?.accepted ?? {}, rounds = (unchanged ? priorRead?.rounds ?? 0 : 0) + (removed ? 1 : 0), stop = rounds >= CUT_READ_ROUNDS;
      // Reasons stay with their ids across re-reads; an id whose flag is gone is dropped.
      const accepted = Object.fromEntries(Object.entries({ ...prior, ...Object.fromEntries((input.accept ?? []).map(item => [item.id, item.reason])) }).filter(([id]) => script.flags.some(flag => flag.id === id)));
      if (taskId) await laneCtx.runMutation(internal.lanes.evidence, { ...taskScope, evidence: { tool: 'readCutScript', timelineId, fingerprint: await timelineHistoryKey(editSession.timeline), input: {}, output: { accepted, rounds, ...(cutAway.length || priorRead?.cutAway?.length ? { cutAway: [...priorRead?.cutAway ?? [], ...cutAway].slice(-60) } : {}), ...(input.heard ? { heard: input.heard, heardCut: cutSignature(script) } : priorRead?.heardCut ? { heard: priorRead.heard, heardCut: priorRead.heardCut } : {}) } } });
      cutRead = true;
      // A reel request that planned and cut the script owns all of it; one that only reads it (show me the script) cuts nothing.
      const strict = lane === 'reel' && (!!task?.script || rounds > 0);
      const kept = Object.keys(accepted), open = script.flags.filter(flag => !kept.includes(flag.id)), failing = open.filter(flag => cutFlagFails(flag, [], strict && !stop) && !(task?.script && flag.kind === 'mid-sentence' && flag.atCut)), speech = open.filter(flag => CUT_FAILING_KINDS.includes(flag.kind));
      const time = (value: number) => Math.round(value * 100) / 100;
      const refreshed = stale ? { refreshed: `The cut changed since the last read (or it was never read), so this call cut nothing${stale.heard ? ' and did not record heard' : ''}: ${stale.drop ? 'its sentence numbers were for an older cut' : 'heard is the verdict on the cut as it is now'}. This result is a fresh read of the cut as it is now. Read the prose below, then send ${stale.drop ? 'drop with these sentence numbers' : 'heard'} in your next readCutScript call.` } : {};
      return { ...refreshed, wordCount: script.words.length, duration: time(script.words.at(-1)!.end), cuts: script.cuts.length,
        opening: { at: time(script.lines[0].start), text: script.lines[0].text.replace(/‖ /g, '') }, closing: { at: time(script.lines.at(-1)!.end), text: script.lines.at(-1)!.text.replace(/‖ /g, '') },
        prose: cutProse(script),
        read: stop ? `This cut has had ${rounds} rounds of cuts: stop cutting. Call readCutScript {heard} naming the spots still open, tell the user about them in plain words, then finish.` : CUT_READING,
        flags: open.map(flag => ({ id: flag.id, kind: flag.kind, at: time(flag.at), end: time(flag.end), clipId: flag.clipId, atCut: flag.atCut, detail: flag.detail, fix: flag.fix })),
        ...(open.some(flag => flag.remove) ? { removable: open.filter(flag => flag.remove).map(flag => flag.id), removeAll: `readCutScript ${JSON.stringify({ remove: open.filter(flag => flag.remove).map(flag => flag.id) })}` } : {}),
        // The removal is reported in plain words: a staged draft’s raw "applied: false" reads as a failure.
        ...(removed ? { removed, removal: `Done: ${removed.length} flagged spot${removed.length === 1 ? "" : "s"} cut out${result?.staged ? ", in this request’s draft (saved when the request finishes)" : " and saved"}. The prose above is the cut as it is now.`, staged: result?.staged ?? false, saved: result?.saved ?? false } : {}),
        ...(kept.length ? { accepted } : {}), clean: !speech.length,
        check: 'The opening line must be the speaker’s first intended line and the closing line the last: trim setup talk, another speaker or trailing chatter around them.',
        next: stop ? (input.heard ? `Noted. ${REST_OF_EDIT}` : `Stop cutting: call readCutScript {heard} naming the spots still open, tell the user about them in plain words, then finish.`) : failing.length ? `Read the prose first. Then fix the ${failing.length} flagged spot${failing.length === 1 ? '' : 's'} finish fails on${strict ? '' : ' at the cuts'}, together with anything else your reading finds, in one readCutScript {remove, drop} call before adding anything on top, and read again. A flag that is two different points, or a repeat the speaker meant, is kept with accept:[{id, reason}].${speech.length > failing.length ? ' Fix the other repeats and false starts too when the request asks to clean the speech.' : ''}` : speech.length ? 'Nothing finish fails on is left. The other flags sit inside footage this request did not cut: fix them only when the request asks to edit the speech. When the user asked to see the script or text, show the prose and point out each point said more than once, abandoned sentence or line that makes no sense, and offer to cut them.' : input.heard ? `Noted. ${REST_OF_EDIT}` : `The flags find no repeats, clipped words or half sentences${open.length ? ' (the pauses are reported, not required: tighten them unless deliberate)' : ''}, but they are hints. Read the prose now: if a point is said twice, a sentence starts and is abandoned, stops before its point, or makes no sense, cut it with drop and read again. When the prose says each point once, call readCutScript {heard} with what the viewer hears in one line, then: ${REST_OF_EDIT}` };
    } }),
    checkSpots: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.checkSpots, description: "Only when the user asks to check the cut edges or faces of a reel: measures the speaker at the first frame, last frame and every cut edge (no face, head turn, eyes down, closed or off camera, reach, movement) on the media worker. Clean edges cost nothing; each flagged spot returns measurements with SOURCE times, the nearest clean frame inside its pause and one 3-frame strip, within the frame budget. Call again with decisions: {spot, action:'move'} (to the suggested frame, or `to` in SOURCE seconds; later clips ripple) or {spot, action:'accept', seen}; more:[spot] once per spot for 5 more frames. When the budget runs out, apply the suggestions and list the unseen spots. finish never requires it.", inputSchema: z.object({ decisions: z.array(z.object({ spot: z.string().min(3).max(140), action: z.enum(['move', 'accept']), to: z.number().min(0).optional().describe('SOURCE seconds to move the edge to; defaults to the suggested clean frame.'), seen: z.string().trim().min(3).max(200).optional().describe('What the frames show, in a few words. Required to accept.') }).strict()).max(40).optional(), more: z.array(z.string().min(3).max(140)).max(6).optional() }).strict(), execute: async (_ctx, input) => {
      const policy = LANES[lane].eyes;
      if (!policy || policy.status !== 'enforced') throw new Error(`checkSpots is not part of the ${lane} lane’s checks. It works in the reel lane.`);
      if (!taskId) throw stepOrderGuard('Start a task first with startTask.');
      await editSession.wait();
      const task = await readTask(['checkSpots']);
      if (task?.script) savedScript = task.script as SavedScript;
      const prior = [...task?.evidence ?? []].reverse().find(item => item.tool === 'checkSpots' && item.timelineId === timelineId)?.output as SpotsEvidence | undefined;
      const sources = [...new Set(editSession.timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId).map(clip => clip.assetId!))].slice(0, 6);
      await Promise.all(sources.map(id => loadAsset(id).catch(() => undefined)));
      const shotsOf = (): Record<string, Range[]> => savedScript?.broll ? { [savedScript.assetId]: savedScript.broll } : {};
      const key = (spot: { assetId: string; side: string; source: number }) => `${spot.assetId}:${spot.side}:${spot.source.toFixed(2)}`;
      const accepted = [...prior?.accepted ?? []], rounds = { ...prior?.rounds ?? {} }, edgeChanges: string[] = [];
      let result: Record<string, unknown> = {};
      // Decisions first: they refer to the spots of the last reading.
      const moves = (input.decisions ?? []).filter(item => item.action === 'move'), accepts = (input.decisions ?? []).filter(item => item.action === 'accept');
      for (const decision of accepts) {
        const spot = reelSpots(editSession.timeline, assets, shotsOf()).find(item => item.id === decision.spot);
        if (!spot) throw new Error(`Spot ${decision.spot} is not a cut edge of this timeline. Use the ids from the last checkSpots result.`);
        if (!decision.seen) throw new Error(`Say what the frames show to accept ${decision.spot} (seen).`);
        accepted.push({ assetId: spot.assetId, side: spot.side, source: spot.source, seen: decision.seen });
        edgeChanges.push(`${spot.id}: accepted (${decision.seen})`);
      }
      if (moves.length) result = await checkpoint(timeline => {
        let next = timeline;
        for (const decision of moves) {
          const spot = reelSpots(next, assets, shotsOf()).find(item => item.id === decision.spot);
          if (!spot) throw new Error(`Spot ${decision.spot} is not a cut edge of this timeline. Use the ids from the last checkSpots result.`);
          const to = decision.to ?? prior?.spots.find(item => item.id === decision.spot)?.moveTo;
          if (to === undefined) throw new Error(`Spot ${decision.spot} has no measured clean frame to move to. Give to (SOURCE seconds inside ${spot.from.toFixed(2)}-${spot.to.toFixed(2)} s), accept it with what you saw, or re-plan with planScript to use another take.`);
          next = moveEdge(next, spot, to);
          edgeChanges.push(`${spot.id}: moved from source ${spot.source.toFixed(2)} to ${to.toFixed(2)} s`);
        }
        return next;
      });
      // Measure the cut as it stands now.
      const { budget, save } = await frameBudget(policy.frames.total), images: { label: string; data: string; mimeType: string }[] = [];
      const measure = async () => {
        const spots = reelSpots(editSession.timeline, assets, shotsOf()), readings: ReturnType<typeof readSpot>[] = [];
        for (const assetId of [...new Set(spots.map(spot => spot.assetId))]) {
          const own = spots.filter(spot => spot.assetId === assetId), duration = assets.find(asset => asset._id === assetId)?.duration;
          const times = [...new Set(own.flatMap(spot => spotTimes(spot, duration)))];
          // The worker measures up to 480 frames per read; a long reel is read in several.
          const samples: Awaited<ReturnType<typeof runLooksRead>>['samples'] = [];
          for (let index = 0; index < times.length; index += 480) samples.push(...(await runLooksRead(ctx, run.ownerId, run.projectId, assetId, times.slice(index, index + 480), undefined, abortSignal)).samples);
          // A voice-over or a screen recording has no speaker to judge.
          if (samples.filter(sample => sample.face > 0).length < samples.length * .4) { readings.push(...own.map(spot => ({ spot, flagged: false, seen: [] }))); continue; }
          // Frames of a b-roll shot beside an edge show no speaker by design.
          const shots = shotsOf()[assetId] ?? [], speaker = samples.filter(sample => !shots.some(shot => sample.time >= shot.start - .05 && sample.time <= shot.end + .05));
          const baseline = lookBaseline(speaker);
          readings.push(...own.map(spot => readSpot(spot, speaker, policy, baseline)));
        }
        return readings;
      };
      let readings: ReturnType<typeof readSpot>[];
      try {
        readings = await measure();
        // The ending gets its short natural tail without a look: every frame up to it measured clean.
        const ending = readings.find(reading => reading.spot.last && !reading.flagged && reading.moveTo !== undefined);
        if (ending) {
          result = await checkpoint(timeline => moveEdge(timeline, ending.spot, ending.moveTo!));
          edgeChanges.push(`${ending.spot.id}: ending extended from source ${ending.spot.source.toFixed(2)} to ${ending.moveTo!.toFixed(2)} s, a natural tail after the last word`);
          readings = (await measure()).map(reading => reading.spot.last && !reading.flagged ? { ...reading, moveTo: undefined } : reading);
        }
      } catch (error) {
        if (abortSignal.aborted) throw error;
        const unavailable = error instanceof Error ? error.message : 'The media worker could not measure faces.';
        await laneCtx.runMutation(internal.lanes.evidence, { ...taskScope, evidence: { tool: 'checkSpots', timelineId, fingerprint: await timelineHistoryKey(editSession.timeline), input: {}, output: { cutKey: cutKey(editSession.timeline), spots: [], accepted, rounds, framesUsed: budget.used, unavailable } satisfies SpotsEvidence } });
        return { ...result, measured: false, unavailable, warning: `Awkward looks: ${LOOKS_UNMEASURED}.`, next: 'Nothing to decide and nothing to retry: finish does not fail on this. Continue with captions and finish, and say in the reply that the cut edges were not checked for awkward looks.' };
      }
      const isAccepted = (spot: { assetId: string; side: string; source: number }) => accepted.some(item => item.assetId === spot.assetId && item.side === spot.side && Math.abs(item.source - spot.source) < .08);
      const flagged = readings.filter(reading => reading.flagged && !isAccepted(reading.spot)).sort((a, b) => Number(b.spot.first || b.spot.last) - Number(a.spot.first || a.spot.last));
      const unverified = new Set<string>(), notes: Record<string, string> = {};
      const clampTime = (time: number, assetId: string) => Math.round(Math.max(0, Math.min((assets.find(asset => asset._id === assetId)?.duration ?? Infinity) - .05, time)) * 100) / 100;
      // First look: one strip of three frames per flagged spot not yet shown. Extra round: five frames, once per spot.
      const firstLook = flagged.filter(reading => !rounds[key(reading.spot)]), extra = flagged.filter(reading => input.more?.includes(reading.spot.id));
      const show = async (group: typeof flagged, frames: number, times: (reading: (typeof flagged)[number]) => number[], round: number) => {
        const shown = group.filter(reading => { if ((rounds[key(reading.spot)] ?? 0) >= round) { if (round === 2) notes[reading.spot.id] = 'Its extra round is used: move it, accept it, or report it unverified.'; return false; } if (budget.take(frames, frames) < frames) { unverified.add(reading.spot.id); return false; } return true; });
        for (const assetId of [...new Set(shown.map(reading => reading.spot.assetId))]) {
          const own = shown.filter(reading => reading.spot.assetId === assetId), listed = own.map(reading => times(reading).map(time => clampTime(time, assetId)));
          const { strips } = await runLooksRead(ctx, run.ownerId, run.projectId, assetId, listed.flat(), frames, abortSignal);
          own.forEach((reading, index) => { if (!strips[index]) { unverified.add(reading.spot.id); return; } rounds[key(reading.spot)] = round; images.push({ label: `Spot ${reading.spot.id} (${reading.spot.first ? 'first frame of the reel' : reading.spot.last ? 'last frame of the reel' : `cut ${reading.spot.side === 'in' ? 'into' : 'out of'} a line`}): source ${listed[index].map(time => `${time.toFixed(2)} s`).join(', ')}. The cut is at ${reading.spot.source.toFixed(2)} s${reading.moveTo !== undefined ? `; suggested clean frame ${reading.moveTo.toFixed(2)} s` : '; no clean frame was measured in this pause'}.`, data: strips[index], mimeType: 'image/jpeg' }); });
        }
      };
      try {
        await show(firstLook, policy.frames.firstLook, reading => { const { source, side } = reading.spot, target = reading.moveTo; return [...new Set(side === 'in' ? [source - .25, source, target !== undefined && target > source ? target : source + .25] : [target !== undefined && target < source ? target : source - .25, source, target !== undefined && target > source ? target : source + .25])].sort((a, b) => a - b); }, 1);
        await show(extra, policy.frames.extraRound, reading => { const low = Math.max(reading.spot.from, reading.spot.source - .5), high = Math.min(reading.spot.to, reading.spot.source + .5); return Array.from({ length: policy.frames.extraRound }, (_, index) => low + (high - low) * index / (policy.frames.extraRound - 1)); }, 2);
      } catch (error) { if (abortSignal.aborted) throw error; flagged.forEach(reading => { if (!images.some(image => image.label.startsWith(`Spot ${reading.spot.id} `))) unverified.add(reading.spot.id); }); }
      await save();
      const records: SpotRecord[] = readings.map(reading => ({ id: reading.spot.id, side: reading.spot.side, assetId: reading.spot.assetId, source: reading.spot.source, timeline: reading.spot.timeline, first: reading.spot.first, last: reading.spot.last,
        status: isAccepted(reading.spot) && (reading.flagged || reading.unmeasured) ? 'accepted' : reading.unmeasured ? 'unverified' : !reading.flagged ? 'clean' : unverified.has(reading.spot.id) ? 'unverified' : 'flagged', seen: reading.seen, ...(reading.moveTo !== undefined ? { moveTo: reading.moveTo } : {}) }));
      await laneCtx.runMutation(internal.lanes.evidence, { ...taskScope, evidence: { tool: 'checkSpots', timelineId, fingerprint: await timelineHistoryKey(editSession.timeline), input: {}, output: { cutKey: cutKey(editSession.timeline), spots: records, accepted, rounds, framesUsed: budget.used } satisfies SpotsEvidence } });
      const open = records.filter(record => record.status === 'flagged' || record.status === 'unverified');
      return { ...result, measured: true, edges: records.length, clean: records.filter(record => record.status === 'clean').length, accepted: records.filter(record => record.status === 'accepted').length, ...(edgeChanges.length ? { edgeChanges } : {}),
        flagged: open.map(record => ({ spot: record.id, where: record.first ? 'first frame of the reel' : record.last ? 'last frame of the reel' : `cut ${record.side === 'in' ? 'into' : 'out of'} a line`, timeline: record.timeline, source: record.source, measured: record.seen, ...(record.moveTo !== undefined ? { suggestedCleanFrame: record.moveTo } : { suggestedCleanFrame: null }), ...(record.status === 'unverified' ? { frames: 'not shown: frame budget used up' } : {}), ...(notes[record.id] ? { note: notes[record.id] } : {}) })),
        frames: budget.report(), images,
        next: !open.length ? 'Every cut edge is clean or accepted. Add captions if they are missing, then call finish.'
          : `Look at each strip, then call checkSpots with one decision per flagged spot: move when the frame at the cut looks awkward and the suggested frame looks fine; accept with what you saw when the cut frame is fine as it is, or when no clean frame exists and the line must stay. ${open.some(record => record.moveTo === undefined) ? 'A spot with no clean frame can also be fixed by re-planning with planScript to keep another take. ' : ''}One extra round per spot is allowed (more:[spot]) when three frames do not settle it.${unverified.size ? ` Not shown (budget): ${[...unverified].join(', ')}. For those, move to the measured clean frame where one exists and name the rest as unverified in your reply.` : ''}` };
    }, toModelOutput: (ctx, options) => labeledImages(ctx, options.output) }),
    cleanSpeech: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.cleanSpeech, description: "Remove filler words, breaths, pauses and abandoned retakes from one existing video/audio clip in ONE change, using the measured speech cleanup map: cuts sit between words, a retake keeps its final attempt, edges snap to word sound. minConfidence (default 0.6) and kinds limit what goes; preview:true returns the cuts without editing; keep limits it to those SOURCE ranges. Pieces compact at the clip's timeline start with linked audio kept; other clips keep their positions. Report its speechCleanup summary, then call readCutScript. Cut before adding opening clips, b-roll, images or overlays.", inputSchema: z.object({ clipId: z.string().min(1).max(100), minConfidence: z.number().min(0).max(1).optional(), kinds: z.array(z.enum(['pause', 'breath', 'filler', 'restart'])).min(1).max(4).optional(), preview: z.boolean().optional(), keep: z.array(z.object({ start: z.number().min(0), end: z.number().positive() }).strict()).min(1).max(100).optional() }), execute: async (_ctx, input) => {
      if (input.keep?.some((range, index) => range.end <= range.start || (index > 0 && range.start < input.keep![index - 1].end))) throw new Error('keep ranges must be ordered and non-overlapping.');
      const speech = await speechEvidence(input.clipId);
      if (!speech.cleanup) throw new Error('Speech cleanup measurements are unavailable for this source. The media processor has not measured it yet; trim with retainSourceRanges instead.');
      const kinds = new Set<string>(input.kinds ?? (input.keep ? ['pause', 'breath', 'filler'] : ['pause', 'breath', 'filler', 'restart']));
      const chosen = input.keep ?? [{ start: speech.clip.sourceStart, end: speech.sourceEnd }];
      return applySpeechCut(input.clipId, speech, chosen, kinds, input.minConfidence ?? .6, input.preview);
    } }),
    setSplitEdits: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setSplitEdits, description: "Set J and L cuts (split edits) on existing video cuts in ONE saved change, keeping picture and sound in sync and the picture gapless; never build them with unlink, trim, split or move. Without cuts it sets every cut on the main video layer (or track / range); cuts picks some by timeline second (at) or by the video clip before the cut (clipId); with both, clipId names the cut and at is used only when that clip has no cut after it. type auto (default) picks J or L per cut from the word timings and skips cuts with silence on both sides or one continuous take; J or L only for the user's explicit choice; none removes split edits and relinks picture and sound (do that before a later trim or cut-edge move, then set them again). frames is the picture-to-sound offset, default 10 at 30 fps (8–12 useful). fadeFrames 1–2 hides a click. A cut without room is skipped with its reason; calling again changes nothing. Returns cuts and skippedCuts: tell the user both in a line or two.", inputSchema: z.object({
      cuts: z.array(z.object({ at: z.number().min(0).optional().describe('Timeline second of the cut.'), clipId: z.string().min(1).max(100).optional().describe('The video clip before the cut.'), type: z.enum(['J', 'L', 'auto', 'none']).optional(), frames: z.number().int().min(1).max(240).optional() }).strict().refine(cut => cut.at !== undefined || cut.clipId !== undefined, { message: 'Name the cut: add at (its timeline second) or clipId (the video clip before it).' })).min(1).max(200).optional().describe('Omit for every cut on the layer.'),
      range: z.object({ start: z.number().min(0), end: z.number().positive() }).strict().refine(range => range.end > range.start, { message: 'range.end must be after range.start.' }).optional().describe('Timeline seconds: only cuts inside it (when cuts is omitted).'),
      track: shotTrackInput,
      type: z.enum(['J', 'L', 'auto', 'none']).optional().describe('For every cut that does not name its own. Default auto.'),
      frames: z.number().int().min(1).max(240).optional(),
      fadeFrames: z.number().int().min(0).max(12).optional(),
      edits: z.array(z.object({ clipId: z.string().min(1).max(100), kind: z.enum(['J', 'L']), seconds: z.number().positive().max(MAX_SPLIT_EDIT_SECONDS) }).strict()).min(1).max(100).optional().describe('Older form of cuts: clipId, kind and seconds.'),
    }).strict().refine(input => !(input.cuts && input.edits), { message: 'Use cuts or edits, not both.' }), execute: async (_ctx, input) => {
      await editSession.wait();
      // Word timings of every source on a video layer: the tool reports the words at each edit and auto chooses by them.
      const spoken = new Map<string, SpokenWord[]>();
      // Removing split edits reads no words.
      const needsWords = input.edits !== undefined || (input.cuts ?? [{ type: input.type }]).some(cut => (cut.type ?? input.type ?? 'auto') !== 'none');
      await Promise.all((needsWords ? [...new Set(editSession.timeline.clips.flatMap(clip => clip.kind === 'video' && clip.assetId ? [clip.assetId] : []))] : []).map(async assetId => {
        let asset = await loadAsset(assetId).catch(() => undefined);
        if (asset && !asset.analysis?.transcript?.words.length && asset.audioAssetId) asset = await loadAsset(asset.audioAssetId).catch(() => undefined);
        const transcript = asset?.analysis?.transcript;
        if (!asset || !transcript?.words.length) return;
        const edges = currentSpeechCleanup(asset.analysis?.speechCleanup) ? asset.analysis!.speechCleanup!.edges : undefined;
        // Measured sound edges where the source has them; otherwise the transcript's words pulled back to measured quiet.
        const words = edges?.length === transcript.words.length * 2 ? transcript.words.map((word, index) => ({ text: word.text, start: edges[index * 2], end: edges[index * 2 + 1] }))
          : (asset.analysis?.audioActivity ? refineTranscriptWithAudioActivity(transcript, asset.analysis.audioActivity) : transcript).words;
        spoken.set(assetId, words);
      }));
      let outcome: Pick<SplitEditResult, 'applied' | 'skipped' | 'unchanged'> = { applied: [], skipped: [], unchanged: 0 };
      const saved = await checkpoint(t => {
        const request = input.edits ? { cuts: input.edits.map(edit => ({ clipId: edit.clipId, type: edit.kind, frames: Math.max(1, Math.round(edit.seconds * t.fps)) })) } : { cuts: input.cuts, range: input.range, track: input.track, type: input.type, frames: input.frames, fadeFrames: input.fadeFrames };
        const result = applySplitEdits(t, request, { duration: assetId => assets.find(asset => asset._id === assetId)?.duration, audioAssetOf: assetId => assets.find(asset => asset._id === assetId)?.audioAssetId, words: assetId => spoken.get(assetId) });
        outcome = result;
        return result.timeline;
      });
      const { applied, skipped, unchanged } = outcome, count = (type: string) => applied.filter(item => item.type === type).length;
      return { ...saved, fps: editSession.timeline.fps, summary: `${count('J')} J, ${count('L')} L${count('none') ? `, ${count('none')} removed` : ''}, ${skipped.length} skipped${unchanged ? `; ${unchanged} already set` : ''}`, cuts: applied, skippedCuts: skipped,
        ...(applied.some(item => item.type !== 'none') ? { next: 'Picture and sound of these cuts are no longer linked, by design. Do not trim, move or relink them by hand, and do not move a cut edge (checkSpots, resizeClips) while they are set: call setSplitEdits with type none first, make the change, then set them again.' } : {}) };
    } }),
    split: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.split, description: "Split an existing clip at a timeline time in seconds. The cut lands on the nearest timeline frame; a cut that would leave a piece shorter than 2 frames is refused (use the clip's own edge). Source edits remain staged until the request completes. For a speech cut with several retained source ranges, prefer retainSourceRanges instead of a split/trim/delete chain.", inputSchema: z.object({ clipId: z.string(), time: z.number().min(0) }), execute: async (_ctx, input) => checkpoint(t => splitClip(t, input.clipId, input.time, crypto.randomUUID(), MIN_CUT_FRAMES)) }),
    trim: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.trim, description: "Change a clip's duration and optional SOURCE trim start, in seconds: clipId/duration/sourceStart for one clip, or edits:[{clipId,duration,sourceStart?}] for several in one operation, never both; target a linked pair once (its audio follows). Shortening on the main footage layer ripples later clips earlier unless ripple:false; a hole left behind is reported in gapWarning. Effect clips have no source trim: duration stretches them. A duration running into the next clip on the layer is refused with the room available. Times snap to the frame grid; changedClips shows what was set.", inputSchema: z.object({ ripple:z.boolean().optional().describe('Close up after a shortened clip: later clips on its layer move earlier with their linked audio. Default true for footage on the main footage layer, false elsewhere. Pass false to leave the hole.'),clipId:z.string().min(1).optional(),duration:z.number().positive().optional(),sourceStart:z.number().min(0).optional(),edits:z.array(trimChangeInput).min(1).max(200).refine(edits=>new Set(edits.map(edit=>edit.clipId)).size===edits.length,{message:'Choose unique clip IDs.'}).optional() }).strict().refine(input=>input.edits!==undefined?input.clipId===undefined&&input.duration===undefined&&input.sourceStart===undefined:input.clipId!==undefined&&input.duration!==undefined,{message:'Specify one clipId/duration or an edits array.'}), execute: async (_ctx, input) => { let rippled:{clipId:string;movedClips:number;earlierBy:number}[]=[]; const saved=await checkpoint(t => {
      const edits=input.edits??[{clipId:input.clipId!,duration:input.duration!,sourceStart:input.sourceStart}];
      const ids=new Set(edits.map(edit=>edit.clipId));
      for(const edit of edits){const clip=find(t,edit.clipId);if(clip.linkedClipId&&ids.has(clip.linkedClipId))throw new Error('Trim each linked pair once; its matching audio follows automatically.');}
      let next=t;rippled=[];
      for(const edit of edits){
        const clip=find(next,edit.clipId),oldEnd=clip.start+clip.duration;
        // The new end goes on the frame grid before anything ripples behind it.
        const duration=clip.kind==='video'||clip.kind==='image'||clip.kind==='audio'?Math.max(1/next.fps,snapTime(clip.start+edit.duration,next.fps)-clip.start):edit.duration;
        next=trimClip(next,clip.id,duration,edit.sourceStart);
        const removed=clip.duration-find(next,clip.id).duration;
        // Shortening footage on the main layer closes up unless the caller asked for the hole.
        if(removed>1e-6&&(input.ripple??onMainFootageTrack(t,clip.id))){const closed=rippleAfter(next,clip.id,oldEnd,removed);if(closed){next=closed.timeline;rippled.push({clipId:clip.id,movedClips:closed.shifted,earlierBy:Math.round(removed*1000)/1000});}}
      }
      return next;
    });
    return rippled.length?{...saved,rippled,rippleNote:'Later clips on the trimmed layer moved earlier with their linked audio to close up. Captions, music and overlays on other layers kept their times. Pass ripple:false to leave a hole instead.'}:saved; } }),
    move: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.move, description: "Move a clip in seconds or within its own track group: effects use FX1–FX24, video/images/text/solid-color use V1–V24, and audio uses A1–A12. The clip kind determines the group; Legacy solid-color FX can be explicitly converted using convertSolidColorToVisual before moving onto V. Start snaps to project frames; an occupied layer bumps the clip to the next free layer, and linked audio moves with its video exactly as a manual drag. Save immediately.", inputSchema: z.object({ clipId: z.string(), start: z.number().min(0).optional(), track: z.number().int().min(1).max(24).optional() }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (input.start === undefined && input.track === undefined) throw new Error("Specify a timeline start or a layer"); return moveClipTo(t, clip.id, input.start, input.track); }) }),
    delete: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.delete, description: "Remove clips in ONE saved change: clipId, exact clipIds, or at (a timeline second or a list of them) for the shot showing there. A video shot goes with its linked audio. ripple closes the gap by moving later clips on the same layers earlier; it is the default when every removed clip is footage on the main footage layer, and ripple:false leaves a hole there, ripple:true closes up anywhere. Music, captions and other layers keep their times. Never delete and then move later clips one by one. Unlink first to keep only one side of a linked pair. Returns removedClipIds.", inputSchema: z.object({clipId:z.string().min(1).optional(),clipIds:clipIdsInput.optional(),at:z.union([shotTimeInput,z.array(shotTimeInput).min(1).max(100)]).optional(),track:shotTrackInput,ripple:z.boolean().optional().describe('Close the gap on the removed clips\' layers. Default true for footage on the main footage layer, false elsewhere.')}).strict().refine(input=>[input.clipId,input.clipIds,input.at].filter(value=>value!==undefined).length===1,{message:'Choose exactly one of clipId, clipIds or at.'}), execute: async (_ctx, input) => {
      let removedClipIds:string[]=[],resolved:string[]=[],ripple=false;
      const saved=await checkpoint(t=>{
        const ids=input.at!==undefined?[...new Set((Array.isArray(input.at)?input.at:[input.at]).map(time=>shotAt(t,time,input.track).id))]:input.clipIds??[input.clipId!];
        for(const id of ids)find(t,id);
        // Removing footage from the main footage layer closes up unless the caller asked for the hole.
        ripple=input.ripple??ids.every(id=>onMainFootageTrack(t,id));
        const result=removeShots(t,ids,ripple);removedClipIds=result.removedClipIds;resolved=ids;return result.timeline;
      });
      return {...saved,removedClipIds,...(input.at!==undefined?{resolvedClipIds:resolved}:{}),rippled:ripple,...(ripple&&input.ripple===undefined?{rippleNote:'Later clips on that layer moved earlier with their linked audio to close up. Pass ripple:false to leave a hole instead.'}:{})};
    } }),
    addCaption: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addCaption, description: "Add a timed caption with explicit text, styling and normalized position; save immediately. Defaults to minimal readable static subtitles with NO background. Add a box or animation only when requested; explicit background styling is preserved.", inputSchema: textInput, execute: async (_ctx, {textStyle,...input}) => checkpoint(t => placeOnFreeLayer(t, { id: crypto.randomUUID(), kind: "caption", sourceStart: 0, ...DEFAULT_CAPTION_STYLE, ...input, ...(textStyle?{textStyle:{...DEFAULT_CAPTION_STYLE.textStyle,...textStyle}}:{}) })) }),
    addGraphic: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addGraphic, description: "Add a text motion graphic with explicit text, styling and normalized position; save immediately.", inputSchema: textInput, execute: async (_ctx, {textStyle,...input}) => checkpoint(t => placeOnFreeLayer(t, { id: crypto.randomUUID(), kind: "graphic", sourceStart: 0, ...DEFAULT_GRAPHIC_STYLE, ...input, ...(textStyle?{textStyle:{...resolvedTextAppearance({kind:"graphic"}),...textStyle}}:{}) })) }),
    remember: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.remember, description: "Save to the user's memory so future edits in any project follow it. kind preference: one lasting rule ('Prefers captions in yellow, top third.'), when the user says always, never, I prefer or my brand, or corrects the same thing twice. kind style: an edit the user liked, with a short name, a one-line summary and the recipe (the exact tools and settings, read with inspectClip; compact, never whole clips or IDs). scope user (default) or project; memoryId updates one. Never save one-off requests, secrets, or what the user asks you not to keep. Tell the user in a few words what you remembered.", inputSchema: z.object({ kind: z.enum(['preference', 'style']).optional(), text: z.string().min(3).max(280), name: z.string().min(1).max(60).optional(), recipe: z.string().min(1).max(6000).optional(), scope: z.enum(['user', 'project']).optional(), memoryId: z.string().optional() }).strict(), execute: async (_ctx, input) => {
      const saved = await ctx.runMutation(internal.memories.remember, { ...run, kind: input.kind ?? 'preference', text: input.text, scope: input.scope ?? 'user', ...(input.name ? { name: input.name } : {}), ...(input.recipe ? { recipe: input.recipe } : {}), ...(input.memoryId ? { memoryId: input.memoryId } : {}) });
      return { remembered: saved };
    } }),
    recallMemory: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.recallMemory, description: "Load a remembered style's full recipe by memoryId before reapplying it: when the user says 'my usual', 'like last time', 'same captions as the podcast', or the request matches a saved style. Apply the recipe with the normal tools, adapting positions and timing to this footage, and say which style you used.", inputSchema: z.object({ memoryId: z.string().min(1) }).strict(), execute: async (_ctx, input) => ctx.runMutation(internal.memories.recall, { ...run, memoryId: input.memoryId }) }),
    forget: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.forget, description: "Delete a memory by memoryId when the user asks you to forget it or it no longer holds. Tell the user what you forgot.", inputSchema: z.object({ memoryId: z.string().min(1) }).strict(), execute: async (_ctx, input) => {
      await ctx.runMutation(internal.memories.forget, { ...run, memoryId: input.memoryId });
      return { forgotten: input.memoryId };
    } }),
    getFrames: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getFrames, description: `Frames of the saved timeline at timeline seconds, composited as the export draws them. Several come back as ONE contact sheet, up to ${MAX_SHEET_FRAMES} per call; one time returns a larger frame, resolution 1080 a full-size one. times for a spot that looks wrong in the frames finish returned, range to scan a stretch at about one frame a second, around for a few consecutive frames at one moment. Never one per cut or caption, and never consecutive frames to watch a clip: the transcript says where to look. revision (from listRevisions) renders an earlier saved version before restoreClip. Each call takes 10–30 s.`, inputSchema: z.object({ resolution:z.union([z.literal(720),z.literal(1080)]).optional().describe('Default: small tiles on a sheet, or a preview for one frame. 1080 returns one full-size composition frame without resizing for precise layout inspection.'), times: z.array(z.number().min(0)).min(1).max(120).optional().describe(`Timeline seconds, inside the timeline. More than ${MAX_SHEET_FRAMES} are thinned to ${MAX_SHEET_FRAMES} evenly spaced ones and the result says so.`), range: z.object({ start: z.number().min(0), end: z.number().min(0), step: z.number().positive().optional().describe('Seconds between frames, default 1.') }).optional().describe(`Scan a stretch: evenly spaced frames from start to end, at most ${MAX_SHEET_FRAMES}.`), around: z.object({ time: z.number().min(0), frames: z.number().int().min(1).max(MAX_ZOOM_FRAMES).optional().describe('Consecutive frames, default 5.') }).optional().describe('Zoom in: consecutive frames centered on one timeline second.'), revision: z.number().int().min(0).optional().describe('A saved revision from listRevisions to look at instead of the current timeline.') }), execute: async (_ctx, { times, range, around, revision, resolution }) => {
      await editSession.wait();
      const snapshot = editSession.timeline;
      // An earlier revision may be longer than the current timeline, so its times are only snapped to frames here.
      const look = sampleFrameTimes({ ...(times ? { times } : {}), ...(range ? { range } : {}), ...(around ? { around } : {}) }, revision === undefined ? timelineDuration(snapshot) : Number.MAX_SAFE_INTEGER, snapshot.fps);
      if (resolution === 1080 && look.times.length !== 1) throw new Error('1080 returns one full-size frame: pass a single time.');
      const result = resolution === 1080 ? await renderFrames(look.times, revision, undefined, resolution) : await renderSheet(look.times, revision);
      if (revision === undefined && snapshot === editSession.timeline && result.revision === editSession.revision) fastReview.reviewed(result.frames.map(frame => frame.time), snapshot);
      return { ...result, ...(look.note ? { note: look.note } : {}) };
    }, toModelOutput: async (ctx, options) => { const output = options.output as { revision: number; atRevision?: number; resolution?:number; note?: string; sheet?: string; frames: { time: number; image: string }[] }; const of = output.atRevision !== undefined ? `timeline as it was at revision ${output.atRevision}` : `saved timeline (revision ${output.revision})`, at = output.frames.map(frame => `${frame.time.toFixed(3)}s`).join(', '); return { type: 'content' as const, value: [
      { type: 'text' as const, text: `${output.sheet ? `One contact sheet of ${output.frames.length} frames of the ${of}, left to right, top to bottom, each labeled with its time: ${at}.` : `${output.resolution===1080?'1080p':'Preview'} frames of the ${of} at ${at}, in that order.`}${output.note ? ` ${output.note}` : ''}` },
      ...(output.sheet ? [await imagePart(ctx, output.sheet, 'image/jpeg')] : await Promise.all(output.frames.map(frame => imagePart(ctx, frame.image, 'image/jpeg')))),
    ] }; } }),
    checkPacing: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.checkPacing, description: "Check how motion reads over time on a timeline range: renders 10 samples a second and returns the change per second plus flagged moments (a change held under about 1 s, 3+ changes within 1 s, a zoom or pan starting or stopping at full speed or cut mid-move, a move too fast to follow, a one-sample jump, a flash, a still hold of 3 s or more). Run it on the changed range after building or changing motion and fix what it flags. Long ranges run in chunks: follow every nextAction until completed is true.", inputSchema: z.object({ checkId:z.string().min(1).optional().describe('Resume a pending saved chunk from nextAction.'), sourceCheckId:z.string().min(1).optional().describe('Continue the next chunk from this saved check’s frozen timeline; use nextAction.'), revision:z.number().int().nonnegative().optional().describe('Keep nextAction on the original saved revision.'), start: z.number().min(0).optional().describe('Timeline second to start at (default 0).'), end: z.number().positive().optional().describe('Timeline second to end at (default the end of the timeline).'), fps: z.number().min(2).max(30).optional().describe('Samples a second (default 10).') }).strict(), execute: async (_ctx, input) => checkPacing(input) }),
    getSound: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getSound, description: "Hear a timeline range, which frames cannot show: decodes the range's mix exactly as export mixes it and reports every clip that sounds there (sound effects, voice, music, footage audio) with its time and gain, the moments sounds start (onsets) with their level and which clip made them, momentary loudness (LUFS) and peak each 0.1 s with integrated loudness, silent stretches, and the spoken words with their timeline times. Use it to check what plays where before or after placing sound, music or narration.", inputSchema: z.object({ checkId:z.string().min(1).optional().describe('Resume a pending saved chunk from nextAction.'), sourceCheckId:z.string().min(1).optional().describe('Continue the next chunk from this saved check’s frozen timeline; use nextAction.'), revision:z.number().int().nonnegative().optional().describe('Keep nextAction on the original saved revision.'), start: z.number().min(0).optional().describe('Timeline second to start at (default 0).'), end: z.number().positive().optional().describe('Timeline second to end at (default the end of the timeline).') }).strict(), execute: async (_ctx, input) => listen(input, false) }),
    checkSound: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.checkSound, description: "Check that sound lands with the picture over a range: finds each visual hit (30 samples a second by default) and matches sound-effect onsets to it. Flags a sound with nothing on screen, a hit with no sound, a sound over 2 frames early or late (with the time to move it to), mismatched counts in one moment, a sound effect on a spoken word, and clipping; also returns what getSound does. Run it after adding or retiming sound effects and fix what it flags. Long ranges run in chunks: follow every nextAction until completed is true.", inputSchema: z.object({ checkId:z.string().min(1).optional().describe('Resume a pending saved chunk from nextAction.'), sourceCheckId:z.string().min(1).optional().describe('Continue the next chunk from this saved check’s frozen timeline; use nextAction.'), revision:z.number().int().nonnegative().optional().describe('Keep nextAction on the original saved revision.'), start: z.number().min(0).optional().describe('Timeline second to start at (default 0).'), end: z.number().positive().optional().describe('Timeline second to end at (default the end of the timeline).'), fps: z.number().min(10).max(60).optional().describe('Picture samples a second (default 30, up to the timeline frame rate).') }).strict(), execute: async (_ctx, input) => listen(input, true) }),
    askUser: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.askUser, description: "Ask the user to choose between 2 to 6 options, shown as a choice card in the chat, instead of listing the options in text: a direction, a style, a length, which of several clips. Then end your turn; their choice arrives as their next message. Ask only what you cannot decide from the request, the project or memory. An option can show what it means: preview.time renders the timeline at that second as a picture in the card (build each look on the timeline first, for example style previews, then point each option at its moment); audio is a project sound URL, played in the card. Keep the question to " + CHOICE_TEXT.question + " characters, each label to " + CHOICE_TEXT.label + " and each description to " + CHOICE_TEXT.description + "; longer text is shortened on the card, never rejected.", inputSchema: z.object({ question: z.string().describe(`The question, up to ${CHOICE_TEXT.question} characters; longer text is shortened.`), options: z.array(z.object({ label: z.string().describe(`The option's name, up to ${CHOICE_TEXT.label} characters; longer text is shortened. Never empty.`), description: z.string().optional().describe(`One short line on what the option means, up to ${CHOICE_TEXT.description} characters; longer text is shortened.`), preview: z.object({ time: z.number().min(0).describe('Timeline second to show as this option\'s picture.') }).strict().optional(), audio: z.string().url().optional().describe('A project sound URL to play in the card.') }).strict()).min(2, 'options needs at least 2 entries; add another option or ask in plain text.').max(6, 'options takes at most 6 entries; merge or drop options until 6 remain.') }).strict(), execute: async (_ctx, givenInput) => {
      // Over-long text is shortened to the card's budget, never rejected: a rejected question shows the user nothing.
      const shortened: string[] = [];
      const fit = (value: string, budget: number, field: string) => { const { text, shortened: cut } = fitChoiceText(value, budget); if (cut) shortened.push(field); return text; };
      const rawInput = { question: fit(givenInput.question, CHOICE_TEXT.question, 'question'), options: givenInput.options.map(({ description, ...option }, index) => {
        const label = fit(option.label, CHOICE_TEXT.label, `options[${index}].label`), shown = description === undefined ? '' : fit(description, CHOICE_TEXT.description, `options[${index}].description`);
        return { ...option, label, ...(shown ? { description: shown } : {}) };
      }) };
      if (rawInput.question.length < 3) throw new Error('question is empty or under 3 characters; write the full question to ask.');
      const blank = rawInput.options.findIndex(option => !option.label);
      if (blank >= 0) throw new Error(`options[${blank}].label is empty; give every option a short name.`);
      // The user's pick comes back as the label, so two options must not read the same once shortened.
      const labels = rawInput.options.map(option => option.label.toLowerCase()), twin = labels.findIndex((label, index) => labels.indexOf(label) !== index);
      if (twin >= 0) throw new Error(`options[${labels.indexOf(labels[twin])}].label and options[${twin}].label read the same ("${rawInput.options[twin].label}"); make each label differ within its first ${CHOICE_TEXT.label} characters.`);
      if (rawInput.options.some(option => option.audio && !option.audio.startsWith(`${mediaConfig().url}/read?`))) throw new Error('audio must be a project sound URL.');
      const input = rawInput;
      const times = input.options.flatMap(option => option.preview ? [option.preview.time] : []);
      if (!times.length) return { ...input, asked: true, ...shortenedNote(shortened) };
      const { frames } = await renderFrames(times);
      const images = await Promise.all(times.map((time, index) => {
        const frame = frames.find(item => Math.abs(item.time - time) < 1e-6) ?? frames[index];
        return publishPreview(Uint8Array.from(atob(frame.image.replace(/^data:[^,]*,/, '')), char => char.charCodeAt(0)), 'image/jpeg');
      }));
      let next = 0;
      return { question: input.question, asked: true, options: input.options.map(option => option.preview ? { ...option, image: images[next++] } : option), ...shortenedNote(shortened) };
    } }),
    // Frame readings of a video: a labeled sheet the model looks at, an object tracked frame by frame, exact pixels.
    readFrames: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.readFrames, description: READ_TOOL_DESCRIPTIONS.readFrames, inputSchema: READ_TOOL_INPUTS.readFrames, execute: async (_ctx, input) => { try { const still=assets.find(asset=>asset._id===input.assetId)?.kind==='image'; if(still)input={assetId:input.assetId,start:0,end:0,count:1,...(input.crop?{crop:input.crop}:{})} as typeof input; if(lane==='clip'&&!still){if(input.fps!==undefined){const state=await ctx.runQuery(internal.clipping.completionState,{...clippingRun});if(!('accepted' in state)||!state.accepted||input.end-input.start>1||(input.end-input.start)*input.fps>29)return {success:false,error:'Frame-level source reads are only for framing after planClips accepts candidates: at most 1 second and 30 frames. Action discovery uses targeted inspectVideo windows; finished-tab checkClip QA is optional.'};}if(input.momentsOnly||(input.fps===undefined&&(input.times?input.times.length>12:(input.count??3)>3||input.end-input.start>60)))return {success:false,error:'Clip discovery/framing reads 1-3 stills per candidate, or up to 12 explicit times across candidates in one call. Use stillsOnly:true; no fps or momentsOnly. Use scoped checkClip only for requested finished-tab QA.'};input={...input,count:input.count??3,stillsOnly:true};} return await readTool('readFrames', input); } catch (error) { if (abortSignal.aborted) throw error; return { success: false, error: error instanceof Error ? error.message : 'The frames could not be read.' }; } }, toModelOutput: (ctx, options) => labeledImages(ctx, options.output) }),
    readSkill:createTool({metadata:EDITOR_TOOL_DEFINITIONS.readSkill,description:"Load one known supporting skill or page on demand and enable its tools. Reuse current reads. Preserves the primary workflow and its deliverable. Find skills with discoverCapabilities.",inputSchema:z.object({name:z.string().min(1),page:z.string().max(80).optional()}),execute:async(_ctx,{name,page})=>{const instructions=laneSkill(name,page);await loadCapability(name);return {name,...(page?{page}:{}),lane,instructions};}}),
    addMedia: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addMedia, description: "Add this project's uploaded video/image on a shared visual track (1–24), or audio on an audio track (1–12); save immediately. Adding a video also adds its extracted audio as a linked clip; never add that audio again. Higher V tracks draw above lower ones; one V track can hold different visual kinds, and there is no separate overlay group. On footage with speech, add an opening clip, b-roll or images after the speech cut, at the timeline time of the word or phrase they belong to.", inputSchema: z.object({ assetId: z.string(), track: z.number().int().min(1).max(24).optional(), start: z.number().min(0), duration: z.number().positive(), sourceStart: z.number().min(0) }), execute: async (_ctx, input) => checkpoint(t => { const asset = assets.find(a => a._id === input.assetId); if (!asset) throw new Error("Choose media from this project"); if (recovering && t.clips.some(clip => clip.assetId === input.assetId && Math.abs(clip.start-input.start) < 1/t.fps && Math.abs(clip.duration-input.duration) < 1/t.fps && Math.abs(clip.sourceStart-input.sourceStart) < 1/t.fps)) return t; const id = crypto.randomUUID(); const next = addMediaClip(t, { ...asset, duration: input.duration }, id, input.start, input.track ?? 1); return patchClip(next, id, { sourceStart: input.sourceStart, duration: input.duration,...(lane==='clip'&&asset.kind==='video'&&t.aspectRatio==='vertical'?{fit:'cover' as const}:{}) }); }) }),
    addSoundEffect: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addSoundEffect, description: "Place one recorded CC0 library sound (ids in the effect enum) at its full length on a free A layer at timeline seconds at, frame-snapped; save immediately. Use ONLY when the user explicitly asks for a realistic or recorded sound that the library has (camera shutter, phone vibrate, clock, lock, water, ambience such as city, ocean or server room) or names a library sound; place it at exactly the time they give or the moment they describe. Never add library sounds on your own initiative: generate sound design with generateSound. gain is the clip volume 0..2 (default 0.7). Returns the clip and any audible non-effect audio it overlaps.", inputSchema: z.object({ effect: z.enum(STOCK_AUDIO_IDS), at: z.number().min(0), gain: z.number().min(0).max(2).optional() }), execute: async (_ctx, { effect, at, gain = .7 }) => {
      const sound = stockAudio(effect)!;
      let asset = assets.find(item => item.r2Key === sound.r2Key);
      if (!asset) { asset = await ctx.runMutation(internal.assistant.attachRunStockAudio, { ...run, catalogId: effect }); assets.push(asset); }
      return { ...await placeEffectSound(asset._id, sound.duration, at, gain), effect, name: sound.name, duration: sound.duration };
    } }),
    generateSound: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.generateSound, description: "The default way to add any sound effect: describe it in words and ElevenLabs generates it as real sound design, then it is placed on a free A layer at timeline seconds at (frame-snapped), starting on its first audible sample; save immediately. Time it exactly to the motion: a whoosh as long as a slide-in (duration), a pop per card, a riser into a hit. When the user gives a time, use exactly that time. gain is the clip volume 0..2 (default 0.7); sounds peak at -3 dBFS. If generation fails nothing is placed: say so, never substitute another sound. Returns the clip, its duration and any audible non-effect audio it overlaps.", inputSchema: soundEffectInput.extend({ at: z.number().min(0), gain: z.number().min(0).max(2).optional(), name: z.string().trim().min(1).max(60).optional(), saveToLibrary: z.boolean().optional().describe('true only when the user explicitly asks to keep this sound in their media library. Otherwise the sound lives on the timeline only and is not listed in Media or the Library.') }), execute: async (_ctx, { at, gain = .7, name, saveToLibrary, ...request }) => {
      const asset = await createGeneratedSound(request, name, saveToLibrary);
      return { ...await placeEffectSound(asset._id, asset.duration!, at, gain), name: asset.fileName, duration: asset.duration };
    } }),
    editSound: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.editSound, description: "Regenerate a generated sound clip from a new prompt (and duration), keeping its start, layer and volume (it moves up a layer only if the new length would overlap). inspectClip shows the current prompt. Library and uploaded audio cannot be regenerated; delete and replace them.", inputSchema: soundEffectInput.extend({ clipId: z.string(), name: z.string().trim().min(1).max(60).optional() }), execute: async (_ctx, { clipId, name, ...request }) => {
      await editSession.wait();
      const current = find(editSession.timeline, clipId);
      const previous = assets.find(item => item._id === current.assetId);
      if (current.kind !== 'audio' || !previous?.soundRecipe) throw new Error('Choose a generated sound clip; library and uploaded audio cannot be regenerated.');
      const asset = await createGeneratedSound(request, name ?? previous.fileName.replace(/\.wav$/, ''), previous.libraryHidden === false);
      const result = await checkpoint(t => { const clip = find(t, clipId); return placeOnFreeLayer(t, { ...clip, assetId: asset._id, sourceStart: 0, duration: asset.duration! }); });
      return { ...result, clipId, name: asset.fileName, duration: asset.duration };
    } }),
    addLayer: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addLayer, description: "Add an empty effects-only FX track (up to 24), shared visual V track (up to 24), or audio A track (up to 12). Only effect clips belong to FX tracks. Video, images, captions and graphics share V tracks.", inputSchema: z.object({ group: z.enum(["effects", "visual", "audio"]) }), execute: async (_ctx, input) => checkpoint(t => { const tracks = deriveTrackCounts(t); const maximum = maxTrackCount(input.group); if (tracks[input.group] >= maximum) throw new Error(`This group already has ${maximum} tracks`); return { ...t, tracks: { ...tracks, [input.group]: tracks[input.group] + 1 } }; }) }),
    deleteEmptyLayer: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.deleteEmptyLayer, description: "Delete one EMPTY FX, V or A track without deleting clips. group effects means FX, visual means V, audio means A; track is its current number. Refuses occupied tracks. Higher tracks are renumbered while timing, stacking order, media and linked audio remain intact. Inspect current track numbers again after deletion if needed. Saves immediately.", inputSchema: z.object({ group: z.enum(['effects', 'visual', 'audio']), track: z.number().int().min(1).max(24) }), execute: async (_ctx, input) => checkpoint(t => deleteEmptyLayer(t, input.group, input.track)) }),
    removeEmptyLayers: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.removeEmptyLayers, description: "When the user asks to clean up ALL empty tracks, remove every empty effects/visual/audio track in one saved change. Never deletes clips, changes timing or alters stacking order; occupied FX/V/A tracks become contiguous within their own group.", inputSchema: z.object({}), execute: async () => checkpoint(removeEmptyLayers) }),
    configureSmoothZoom:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureSmoothZoom,description:"One smooth zoom in, optional hold and return on a video/image. start, inDuration, holdDuration and outDuration are TIMELINE seconds; outDuration:0 holds the zoom to the clip end, a nonzero one restores the framing. focus: center for a generic zoom, target (a targetId from inspectFrames for a named modal, cursor or object; never guess) or coordinates (only ones the user gave, in original SOURCE pixels or 0..1, never preview pixels). framing center moves the target toward the center, anchor keeps its screen position. Never fake a returning close-up with a static crop or transform. Replacing custom motion needs the user's permission and replaceMotion:true. Easing and framing guide: readSkill footage-editing page effect-tools.",inputSchema:z.object({clipId:z.string().min(1),start:z.number().min(0),inDuration:z.number().positive(),holdDuration:z.number().min(0),outDuration:z.number().min(0),scale:z.number().min(CAMERA_ZOOM_RANGE[0]).max(CAMERA_ZOOM_RANGE[1]),easing:z.enum(SMOOTH_ZOOM_EASINGS),framing:z.enum(['anchor','center']).optional(),replaceMotion:z.boolean().optional(),focus:z.union([z.object({kind:z.literal('center')}).strict(),z.object({kind:z.literal('target'),targetId:z.string().min(1)}).strict(),z.object({kind:z.literal('coordinates'),centerX:z.number(),centerY:z.number(),units:z.enum(VISUAL_INPUT_UNITS).optional()}).strict()])}),execute:async(_ctx,{clipId,focus,...input})=>checkpoint(t=>{
      const clip=find(t,clipId),asset=assets.find(item=>item._id===clip.assetId);
      if(!asset)throw new Error('Choose media from this project.');
      return patchClip(t,clipId,configureSmoothZoomPatch(clip,{...asset,url:null},t.aspectRatio,input,focus,zoomTargets));
    })}),
    configureCameraMotion:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureCameraMotion,description:"One clip-level camera path on an uploaded video/image: zoom, pan/glide, or sampled following. Send 2–8 keyframes in one call, each with TIMELINE time, scale, focus and easing (a keyframe's easing controls the move into it); the last point holds to the clip end, and returning wide needs an explicit final scale-1 point at the original view center. focus: center (no analysis), target (a targetId from inspectFrames for a named object; never invent coordinates) or coordinates (only ones the user gave, in original SOURCE pixels or 0..1). mode follow: one inspectFrames target per distinct SOURCE instant, at its matching TIMELINE time. Replacing custom object motion needs the user's permission and replaceMotion:true. blurAmount adds speed blur while gliding. Details: readSkill footage-editing page effect-tools.",inputSchema:z.object({clipId:z.string().min(1),mode:z.enum(['glide','follow']).optional(),blurAmount:z.number().min(0).max(1).optional(),replaceMotion:z.boolean().optional(),keyframes:z.array(z.object({time:z.number().min(0),scale:z.number().min(CAMERA_ZOOM_RANGE[0]).max(CAMERA_ZOOM_RANGE[1]),easing:z.enum(SMOOTH_ZOOM_EASINGS),focus:z.union([z.object({kind:z.literal('center')}).strict(),z.object({kind:z.literal('target'),targetId:z.string().min(1)}).strict(),z.object({kind:z.literal('coordinates'),centerX:z.number(),centerY:z.number(),units:z.enum(VISUAL_INPUT_UNITS).optional()}).strict()])}).strict()).min(2).max(8)}).strict(),execute:async(_ctx,{clipId,...input})=>checkpoint(t=>{
      const clip=find(t,clipId),asset=assets.find(item=>item._id===clip.assetId);
      if(!asset)throw new Error('Choose media from this project.');
      return patchClip(t,clipId,configureCameraMotionPatch(clip,{...asset,url:null},t.aspectRatio,input,zoomTargets));
    })}),
    transformClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.transformClip, description: "Set one video/image's static position, scale, rotation or opacity with clipId, OR apply the same requested patch to exact clipIds in one atomic save. Prefer clipIds for the same framing across several clips; never send both target fields. units defaults normalized: center x/y -5..5; 0..1 spans the canvas and off-frame positions are allowed. units pixels uses the canvas reference with shorter dimension1080 (landscape1920×1080, vertical1080×1920), independent of export resolution. Scale0.1..5, rotation degrees±360, opacity0..1. Preserve omitted controls, linked sound and retained source/timing. Reject unknown pixel geometry and invalid/nonvisual targets without saving a partial batch.", inputSchema:z.object({clipId:z.string().min(1).optional(),clipIds:z.array(z.string().min(1)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'}).optional(),...transformFields}).strict().refine(input=>(input.clipId!==undefined)!==(input.clipIds!==undefined),{message:'Choose clipId or clipIds, never both.'}),execute:async(_ctx,input)=>checkpoint(t=>{
      const ids=input.clipIds??[input.clipId!];
      const {units,x,y,scale,rotation,opacity}=input,changes={x,y,scale,rotation,opacity};
      let next=t;
      for(const id of ids)next=patchClip(next,id,transformInputPatch(find(next,id),changes,dimensions(t.aspectRatio),units));
      return next;
    }) }),
    configureVisualFade:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureVisualFade,description:"Set an explicitly requested fade in/out on one video or image clip; also builds a crossfade when the incoming clip overlaps the outgoing one. Apply it directly, without planEffects or previewRender. Fade values are timeline seconds; their total must fit the retained clip duration. Use 0 to remove a requested edge fade. Preserve omitted edge controls, static opacity, crop/motion, source range, clip timing, linked audio/gain/fades and every other clip. Explicit fade edits restart this clip's fade phase; later trims/splits retain it. Saves immediately.",inputSchema:z.object({clipId:z.string(),fadeIn:z.number().min(0).max(VISUAL_FADE_MAX_SECONDS).optional(),fadeOut:z.number().min(0).max(VISUAL_FADE_MAX_SECONDS).optional()}).refine(input=>input.fadeIn!==undefined||input.fadeOut!==undefined,{message:'Specify a visual fade in or out.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>configureVisualFade(t,clipId,changes))}),
    animateEffect: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.animateEffect, description: "Keyframe one numeric effect control (control is group.control, same ranges as setVisualEffects, e.g. colorGrade.saturation, softBlur.amount) on a video or image clip. keyframes: 1–9 anchors in CLIP-LOCAL seconds with absolute values and optional easing (named or cubic-bézier); values hold outside them. The group is switched on while keyframed: set its other controls first with setVisualEffects. Replaces this control's keyframes; clear:true removes them. Examples: readSkill footage-editing page effect-tools.", inputSchema: z.object({ clipId: z.string().min(1), control: z.enum(EFFECT_KEYFRAME_CONTROLS as [string, ...string[]]), keyframes: z.array(z.object({ time: z.number().min(0), value: z.number(), easing: motionEasingInput.optional() }).strict()).max(9).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if (!input.clear && !input.keyframes?.length) throw new Error('Give 1 to 9 keyframes, or clear:true to remove this control\'s keyframes.');
      return patchClip(t, clip.id, effectKeyframesPatch(clip, input.control, input.clear ? null : input.keyframes!));
    }) }),
    setMask: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setMask, description: "Mask a video or image clip so only a shape shows (invert: everything but it): rectangle (corner radius), ellipse, polygon (3–64 [x,y] points in 0..1 of its box) or text (1–40 characters; footage shows through the letters). Geometry is canvas fractions of the clip's frame (x/y center, width/height), rotation in degrees, feather in px at 1080p. keyframes: 1–9 anchors in CLIP-LOCAL seconds with optional easing. Replaces this clip's mask; clear:true removes it. Saves immediately. Examples: readSkill footage-editing page effect-tools.", inputSchema: z.object({ clipId: z.string().min(1), shape: z.enum(MASK_SHAPES).optional(), invert: z.boolean().optional(), radius: z.number().min(0).max(.5).optional(), points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(64).optional(), text: z.string().min(1).max(40).optional(), keyframes: z.array(z.object({ time: z.number().min(0), x: z.number().min(-1).max(2), y: z.number().min(-1).max(2), width: z.number().min(.005).max(4), height: z.number().min(.005).max(4), rotation: z.number().min(-360).max(360).optional(), feather: z.number().min(0).max(200).optional(), easing: motionEasingInput.optional() }).strict()).min(1).max(9).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      const tracking = clip.pixelTracking?.mode === 'mask' ? { pixelTracking: undefined } : {};
      if (input.clear) return patchClip(t, clip.id, { ...tracking, mask: undefined });
      if (!input.shape || !input.keyframes?.length) throw new Error('Give a shape and 1 to 9 keyframes, or clear:true.');
      if (input.keyframes.some(key => key.time > clip.duration + 1e-6)) throw new Error('Mask keyframes must fit inside the clip, in clip-local seconds.');
      const keys = bakeMaskAnchors(input.keyframes.map(key => ({ ...key, rotation: key.rotation ?? 0, feather: key.feather ?? 0 })), clip.motionOffset ?? 0);
      return patchClip(t, clip.id, { ...tracking, mask: { shape: input.shape, ...(input.invert ? { invert: true } : {}), ...(input.radius !== undefined ? { radius: input.radius } : {}), ...(input.points ? { points: input.points } : {}), ...(input.text ? { text: input.text } : {}), keys } });
    }) }),
    blurRegion: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.blurRegion, description: "Blur or pixelate a rectangle of a video clip to hide private details (emails, names, faces, plates, keys) while the rest stays sharp. x/y (top-left) and width/height are 0..1 fractions of the clip's SOURCE frame by default; space:'frame' takes them as fractions of the rendered output frame (what getFrames shows) and converts through the clip's static framing (not for rotated/flipped clips). mode blur (default) or pixelate; strength 1..100 (default 60; 40+ makes text unreadable). start/end: optional CLIP-LOCAL seconds, half-open; omit for the whole clip. They are saved as SOURCE seconds of the media, so inspectClip lists blurRegions times in source seconds and later trims, splits and speed changes keep the region on the same moment; replace keeps a region's saved times unless you give new ones. A clip holds up to 8 regions: each call adds one, replace:index rewrites one (omitted fields keep their values), remove:index deletes one, clear:true removes all (indexes as inspectClip lists them). Static rectangles only; moving content needs one region per stretch with start/end. Preview and every export draw it identically; it keeps exports on the fast path. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), width: z.number().min(MIN_BLUR_REGION_SIZE).max(1).optional(), height: z.number().min(MIN_BLUR_REGION_SIZE).max(1).optional(), space: z.enum(['source', 'frame']).optional(), mode: z.enum(['blur', 'pixelate']).optional(), strength: z.number().min(1).max(100).optional(), start: z.number().min(0).optional(), end: z.number().positive().optional(), replace: z.number().int().min(0).max(MAX_BLUR_REGIONS - 1).optional(), remove: z.number().int().min(0).max(MAX_BLUR_REGIONS - 1).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if (clip.kind !== 'video') throw new Error('Choose a video clip; blur regions apply to video.');
      const current = clip.blurRegions ?? [];
      if (input.clear) return patchClip(t, clip.id, { blurRegions: undefined });
      if (input.remove !== undefined) {
        if (input.remove >= current.length) throw new Error(`This clip has ${current.length} blur region${current.length === 1 ? '' : 's'}; remove takes an index below that.`);
        const rest = current.filter((_, index) => index !== input.remove);
        return patchClip(t, clip.id, { blurRegions: rest.length ? rest : undefined });
      }
      const previous = input.replace !== undefined ? current[input.replace] : undefined;
      if (input.replace !== undefined && !previous) throw new Error(`This clip has ${current.length} blur region${current.length === 1 ? '' : 's'}; replace takes an index below that.`);
      if (!previous && (input.x === undefined || input.y === undefined || input.width === undefined || input.height === undefined)) throw new Error('Give x, y, width and height of the rectangle (0..1 fractions), or clear/remove.');
      if (!previous && current.length >= MAX_BLUR_REGIONS) throw new Error(`A clip holds at most ${MAX_BLUR_REGIONS} blur regions; replace or remove one.`);
      const source: { width?: number; height?: number } = assets.find(asset => asset._id === clip.assetId) ?? {}, canvas = dimensions(t.aspectRatio);
      // Omitted fields come from the region being replaced, in the space the call uses.
      const kept = previous && input.space === 'frame' ? (source.width && source.height ? sourceRectToFrame(previous, clip, { width: source.width, height: source.height }, canvas) : undefined) : previous;
      if (previous && !kept && [input.x, input.y, input.width, input.height].some(value => value === undefined)) throw new Error('Give x, y, width and height together in frame space for this clip.');
      let rect = { x: input.x ?? kept!.x, y: input.y ?? kept!.y, width: input.width ?? kept!.width, height: input.height ?? kept!.height };
      if (input.space === 'frame') rect = frameRectToSource(rect, clip, source, canvas);
      if (rect.x + rect.width > 1 + 1e-6 || rect.y + rect.height > 1 + 1e-6) throw new Error('The rectangle runs past the frame edge: keep x + width and y + height within 1.');
      // Clip-local in, source seconds out; a replaced region keeps its saved times unless new ones are given.
      const start = input.start !== undefined ? input.start : previous?.start !== undefined ? regionLocalTime(clip, previous.start) : undefined;
      const end = input.end !== undefined ? input.end : previous?.end !== undefined ? regionLocalTime(clip, previous.end) : undefined;
      if (input.start !== undefined && input.start >= clip.duration - 1e-6) throw new Error(`start is clip-local seconds and must be below the clip's ${Math.round(clip.duration * 100) / 100} s.`);
      if (start !== undefined && end !== undefined && end <= start) throw new Error('end must be after start.');
      const savedStart = input.start !== undefined ? (input.start > 0 ? regionSourceTime(clip, input.start) : undefined) : previous?.start;
      const savedEnd = input.end !== undefined ? (input.end < clip.duration - 1e-6 ? regionSourceTime(clip, input.end) : undefined) : previous?.end;
      const region = normalizeBlurRegion({ ...rect, mode: input.mode ?? previous?.mode ?? 'blur', strength: input.strength ?? previous?.strength ?? DEFAULT_BLUR_REGION_STRENGTH, ...savedStart !== undefined ? { start: savedStart } : {}, ...savedEnd !== undefined ? { end: savedEnd } : {} });
      const next = input.replace !== undefined ? current.map((item, index) => index === input.replace ? region : item) : [...current, region];
      return patchClip(t, clip.id, { blurRegions: next });
    }) }),
    trackPoints: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.trackPoints, description: "Start durable pixel tracking forward and backward from one TIMELINE seed time, including moving cameras. seed: {kind:'point',x,y} or {kind:'box',box} in normalized SOURCE coordinates, {kind:'target',targetId} from inspectFrames, or {kind:'object',noun} (paid Florence-2 grounding; verify its box). start/end are TIMELINE bounds, default the whole clip; there is no length limit and a confirmed cut ends a direction. Returns trackId at once; getTrack reads progress and samples, and attachToTrack can use it while it runs. No timeline changes.", inputSchema: trackInput, execute: async (_ctx, input) => reportAnalysisFailure(async () => { const reference = await measurePixelTrack(input); return { trackId: reference.trackId, status: 'queued', note: 'Tracking continues in the background. Use getTrack for status and dense pages, or attachToTrack now.' }; }) }),
    getTrack: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.getTrack, description: "Read a pixel track's durable status, confidence and stop reasons. Completed tracks return a dense page of SOURCE-time samples and, for a noun seed, summary.grounding with the detector-proposed box/provider/time. Inspect that box in a source frame; detection is not verified identity and can guess when an object is absent. Pass nextCursor as cursor to read successive pages without dropping frames, or time (SOURCE seconds) to read a local window with smoothing neighbors. No duration/frame cap and no timeline changes.", inputSchema: z.object({ trackId: z.string().min(1), cursor: z.number().nonnegative().optional(), time: z.number().nonnegative().optional() }).strict(), execute: async (_ctx, input) => ctx.runQuery(internal.pixelTracks.pageForRun, { ...run, ...input }) }),
    attachToTrack: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.attachToTrack, description: "Attach text, an image, a graphic, a solid/glow or video to tracked pixels on moving footage. target {trackId} from trackPoints, {time,seed,start?,end?} to start tracking in the background (TIMELINE seconds, same seeds as trackPoints), or 'subject' for face tracking. mode move follows the center plus offsetX/offsetY canvas fractions (box tracks also follow scale and rotation unless followTransform:false) and hides outside the tracked range; smoothing 0..1 (default .35). mode mask needs mask:{shape,width,height}. Saves a tracking reference at once; following starts when the job finishes.", inputSchema: z.object({ clipId: z.string().min(1), footageClipId: z.string().min(1), target: z.union([z.literal('subject'), z.object({ points: z.array(z.object({ time: z.number().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(2) }).strict(), z.object({ trackId: z.string().min(1) }).strict(), trackInput.omit({ footageClipId: true })]), mode: z.enum(['move', 'mask']).optional(), smoothing: z.number().min(0).max(1).optional(), followTransform: z.boolean().optional(), offsetX: z.number().min(-1).max(1).optional(), offsetY: z.number().min(-1).max(1).optional(), mask: z.object({ shape: z.enum(MASK_SHAPES), width: z.number().min(.005).max(4), height: z.number().min(.005).max(4), feather: z.number().min(0).max(200).optional(), invert: z.boolean().optional(), radius: z.number().min(0).max(.5).optional(), text: z.string().min(1).max(40).optional() }).strict().optional() }).strict(), execute: async (_ctx, input) => {
      await editSession.wait();
      const selected = find(editSession.timeline, input.footageClipId), source = selected.assetId ? await loadAsset(selected.assetId) : undefined;
      if (!source) throw new Error('Choose an uploaded footage clip to track.');
      if (input.target === 'subject' && !source.analysis?.focus?.length) await analyze(source._id, 'track');
      const pixelTrack = input.target !== 'subject' && 'trackId' in input.target ? await readPixelTrack(input.target.trackId, selected) : input.target !== 'subject' && 'seed' in input.target ? await measurePixelTrack({ ...input.target, footageClipId: input.footageClipId }) : undefined;
      return checkpoint(t => {
        const footage = find(t, input.footageClipId), clip = find(t, input.clipId), asset = assets.find(item => item._id === footage.assetId);
        if (footage.assetId !== selected.assetId) throw new Error('The source changed during tracking. Track the new footage before attaching.');
        if (!asset) throw new Error('The footage media is unavailable.');
        if (pixelTrack) return patchClip(t, clip.id, streamedAttachmentPatch(clip, footage, asset, t.aspectRatio, pixelTrack, { mode: input.mode ?? 'move', offsetX: input.offsetX, offsetY: input.offsetY, smoothing: input.smoothing, followTransform: input.followTransform, mask: input.mask }));
        const samples = input.target === 'subject' ? asset.analysis?.focus ?? [] : 'points' in input.target ? pointsToSamples(footage, input.target.points) : [];
        if (!samples.length) throw new Error('No moving subject was detected in this footage. Give points from inspectFrames instead.');
        if ((input.mode ?? 'move') === 'mask') {
          if (!input.mask) throw new Error('Mask mode needs mask: {shape, width, height}.');
          return patchClip(t, clip.id, attachMaskPatch(clip, footage, asset, t.aspectRatio, samples, input.mask, { smoothing: input.smoothing, followTransform: input.followTransform, fps: t.fps }));
        }
        return patchClip(t, clip.id, attachOverlayPatch(clip, footage, asset, t.aspectRatio, samples, { x: input.offsetX ?? 0, y: input.offsetY ?? 0 }, { smoothing: input.smoothing, followTransform: input.followTransform, fps: t.fps }));
      });

    } }),
    setMotionBlur: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setMotionBlur, description: "Set motion blur on keyframed movement (animateClip paths on video, image, text or solid clips; camera paths keep their own blurAmount). amount 0..1 (0 off; .5 natural; 1 strong). This blurs keyframed transforms, not the pixel motion from a speed ramp alone; use zoomBlur or directionalBlur for a timed footage rush. Slides and pans get directional blur along the motion, scale pops and punch-ins get radial blur, both scaled by speed so held frames stay sharp. Use for premium-feeling pop-ins, slides and whip moves. Saves immediately.", inputSchema: z.object({ clipIds: clipIdsInput, amount: z.number().min(0).max(1) }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      let next = t;
      for (const id of input.clipIds) {
        const clip = find(next, id);
        if (input.amount > 0 && !clip.motion?.length) throw new Error(`Clip ${id} has no keyframed movement; animate it first with animateClip.`);
        next = patchClip(next, id, { motionBlur: input.amount > 0 ? input.amount : undefined });
      }
      return next;
    }) }),
    setVisualEffects: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setVisualEffects, description: "Set footage effect and color controls on uploaded video/image clips for an explicit effect request or authorized creative styling: clipId, or clipIds to apply the SAME patch to several clips in one atomic save (never both). Omitted controls and other clips are kept; enabled:false bypasses a group and keeps its settings. Neutral: exposure 0 stops, contrast and saturation 1, temperature, tint and vibrance 0; a disabled group or amount 0 changes nothing. Applies to the whole clip and saves immediately. What each control does and typical values: readSkill footage-editing page effect-tools.", inputSchema: z.object({ clipId: z.string().min(1).optional(),clipIds:z.array(z.string().min(1)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'}).optional(), zoomBlur:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional()}).strict().optional(), lensDistortion:z.object({enabled:z.boolean().optional(),amount:z.number().min(-.8).max(.8).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional(),fringing:z.number().min(0).max(10).optional()}).strict().optional(), frameCorners:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional()}).optional(), softBlur:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(40).optional()}).optional(), bloom:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(2).optional(),threshold:z.number().min(0).max(.95).optional(),radius:z.number().min(2).max(80).optional()}).optional(), filmOverlay:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),grain:z.number().min(0).max(1).optional(),dust:z.number().min(0).max(1).optional(),scratches:z.number().min(0).max(1).optional(),vignette:z.number().min(0).max(1).optional(),flicker:z.number().min(0).max(1).optional(),warmth:z.number().min(0).max(1).optional()}).optional(), turbulentDisplace:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(100).optional(),scale:z.number().min(10).max(600).optional(),speed:z.number().min(0).max(3).optional()}).optional(), vhs:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),scanlines:z.number().min(0).max(1).optional(),noise:z.number().min(0).max(1).optional(),bleed:z.number().min(0).max(1).optional(),tracking:z.number().min(0).max(1).optional(),speed:z.number().min(0).max(3).optional()}).optional(), invert: z.object({ enabled: z.boolean().optional(), amount: z.number().min(0).max(1).optional() }).optional(), colorGrade: z.object({ enabled: z.boolean().optional(), exposure: z.number().min(VISUAL_EFFECT_LIMITS.colorGrade.exposure[0]).max(VISUAL_EFFECT_LIMITS.colorGrade.exposure[1]).optional(), contrast: z.number().min(0).max(2).optional(), saturation: z.number().min(0).max(2).optional(), temperature: z.number().min(-100).max(100).optional(), tint: z.number().min(-100).max(100).optional(), vibrance: z.number().min(-100).max(100).optional() }).optional(), glitch: z.object({ enabled: z.boolean().optional(), intensity: z.number().min(0).max(1).optional(), blockSize: z.number().min(1).max(100).optional(), rgbSplit: z.number().min(0).max(50).optional() }).optional() }).strict().refine(input=>(input.clipId!==undefined)!==(input.clipIds!==undefined),{message:'Choose clipId or clipIds, never both.'}), execute: async (_ctx, { clipId,clipIds, ...changes }) => checkpoint(t => {
      let next=t;
      for(const id of clipIds??[clipId!])next=patchClip(next,id,visualEffectsPatch(find(next,id),changes));
      return next;
    }) }),
    setSpeedRamp: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setSpeedRamp, description: "Speed-ramp one video or audio clip (its linked partner follows): the same footage plays at changing speed and the clip becomes source length / average speed long, so leave room after it. preset: montage, hero, bullet, flash-in, flash-out, ramp-in, ramp-out or slowmo-middle; or 2–12 anchors {x: 0..1 of the clip, rate, easing?} for a custom curve. clear:true restores normal speed. Replaces a constant setPlaybackRate speed; saves immediately. What each preset does: readSkill footage-editing page effect-tools.", inputSchema: z.object({ clipId: z.string().min(1), preset: z.enum(SPEED_RAMP_PRESET_IDS as [SpeedRampPreset, ...SpeedRampPreset[]]).optional(), anchors: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(.1).max(10), easing: motionEasingInput.optional() }).strict()).min(2).max(12).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if ([input.preset, input.anchors, input.clear || undefined].filter(value => value !== undefined).length !== 1) throw new Error('Give exactly one of preset, anchors or clear:true.');
      return setClipSpeedRamp(t, clip.id, input.clear ? null : input.preset ? presetAnchors(input.preset) : input.anchors!);
    }) }),
    analyzeColor: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.analyzeColor, description: "Measure a video/image clip's real color from its source frames (not a guess from a description): exposure (median, shadows, highlights, contrast range), saturation, the light's color cast (warmth red-vs-blue, tint green-vs-magenta, from near-neutral midtones), dominant colors with names and shares, plain-language notes (e.g. warm orange cast, underexposed, clipped highlights) and a neutralizing suggestedGrade for setVisualEffects colorGrade. Optional times are timeline seconds inside the clip (1-4; default three across it). Use before color correcting, to explain a look, or to plan a grade that keeps or removes orange tungsten light.", inputSchema: z.object({ clipId: z.string().min(1), times: z.array(z.number().min(0)).min(1).max(4).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId), stats = await measureClip(clip, input.times);
      return { clipId: clip.id, measuredAt: stats.map(item => item.time), ...describeColor(stats), note: 'Measured on the source footage, before this clip\'s grade and effects.' };
    }) }),
    matchColor: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.matchColor, description: "Shot matching: make clips look like a reference clip by measuring both (three frames each) and setting per-channel RGB curves that map each clip's tones onto the reference's (histogram matching), fixing exposure, contrast and color cast between cameras or lighting. strength 0..1 (default 1; .6-.8 keeps some of the original). Matches source footage: the reference's own grade is not included, so match first, then apply one shared grade or LUT to all. Replaces the clips' red/green/blue curves (the master curve is kept).", inputSchema: z.object({ clipIds: clipIdsInput, referenceClipId: z.string().min(1), strength: z.number().min(0).max(1).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
      await editSession.wait();
      const reference = await measureClip(find(editSession.timeline, input.referenceClipId));
      const matched: Record<string, ReturnType<typeof matchCurves>> = {};
      for (const id of input.clipIds) { if (id === input.referenceClipId) continue; matched[id] = matchCurves(await measureClip(find(editSession.timeline, id)), reference, input.strength ?? 1); }
      const saved = await checkpoint(t => { let next = t; for (const [id, curves] of Object.entries(matched)) { const clip = find(next, id); next = patchClip(next, clip.id, { colorCurves: { ...(clip.colorCurves?.master ? { master: clip.colorCurves.master } : {}), ...curves } }); } return next; });
      return { ...saved, matched: Object.keys(matched), reference: describeColor(reference).notes };
    }) }),
    setColorCurves: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setColorCurves, description: "Set RGB and master tone curves on video/image clips (after the basic grade): each curve is 2-16 [input, output] points within 0..1, interpolated smoothly without overshoot. master shapes all channels (S-curve for contrast: [[0,0],[.25,.2],[.75,.82],[1,1]]; lifted blacks for a faded film look: [[0,.08],[1,1]]); red/green/blue shift color by tone (teal shadows: blue [[0,.08],[.5,.5],[1,1]]). Omitted curves are kept; clear:true removes all curves.", inputSchema: z.object({ clipIds: clipIdsInput, master: curveInput.optional(), red: curveInput.optional(), green: curveInput.optional(), blue: curveInput.optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, { clipIds, clear, ...curves }) => checkpoint(t => {
      let next = t;
      for (const id of clipIds) { const clip = find(next, id); next = patchClip(next, clip.id, { colorCurves: clear ? undefined : { ...clip.colorCurves, ...curves } }); }
      return next;
    }) }),
    setHSL: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setHSL, description: `Targeted color by hue band (HSL secondary): for each of ${HSL_BANDS.join(', ')} set hue shift (-60..60 degrees), saturation (-1..1, -1 removes that color) and luminance (-1..1). Bands blend smoothly into neighbors and grays are untouched. Examples: tame orange skin or tungsten light (orange saturation -.3), richer sky (blue saturation .3, luminance -.2), teal foliage (green hue 30), isolate red (every other band saturation -1). Given bands replace those bands; clear:true removes HSL.`, inputSchema: z.object({ clipIds: clipIdsInput, bands: z.object(Object.fromEntries(HSL_BANDS.map(band => [band, z.object({ hue: z.number().min(-60).max(60).optional(), saturation: z.number().min(-1).max(1).optional(), luminance: z.number().min(-1).max(1).optional() }).strict().optional()])) as Record<typeof HSL_BANDS[number], z.ZodOptional<z.ZodObject<{ hue: z.ZodOptional<z.ZodNumber>; saturation: z.ZodOptional<z.ZodNumber>; luminance: z.ZodOptional<z.ZodNumber> }, z.core.$strict>>>).strict().optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      if (!input.clear && !input.bands) throw new Error('Give bands, or clear:true.');
      let next = t;
      for (const id of input.clipIds) {
        const clip = find(next, id), hsl: HslAdjust = { ...clip.hsl };
        for (const [band, shift] of Object.entries(input.bands ?? {})) if (shift) hsl[band as keyof HslAdjust] = { hue: shift.hue ?? 0, saturation: shift.saturation ?? 0, luminance: shift.luminance ?? 0 };
        next = patchClip(next, clip.id, { hsl: input.clear ? undefined : hsl });
      }
      return next;
    }) }),
    applyLut: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyLut, description: `Apply a LUT look to video/image clips, blended by amount 0..1 (default 1; .5-.8 is often enough). Built-in looks: ${LUT_LOOKS.join(', ')}. Or pass cube: the full text of a .cube LUT file (e.g. a camera log-to-Rec709 conversion or a purchased film look) with a name; it is stored once on the timeline (up to ${MAX_TIMELINE_LUTS} custom LUTs) and reused by name. Applied after grade, curves and HSL. clear:true removes the LUT.`, inputSchema: z.object({ clipIds: clipIdsInput, look: z.string().min(1).max(60).optional().describe('A built-in look, or the name of a custom LUT already stored'), cube: z.string().min(20).max(3_000_000).optional(), name: z.string().min(1).max(60).optional(), amount: z.number().min(0).max(1).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      let next = t, look: string | undefined;
      if (input.cube) {
        const parsed = parseCube(input.cube), name = input.name ?? 'Custom LUT', existing = next.luts?.find(lut => lut.name === name);
        const id = existing?.id ?? crypto.randomUUID().slice(0, 8);
        const luts = [...(next.luts ?? []).filter(lut => lut.id !== id), { id, name, ...parsed }];
        if (luts.length > MAX_TIMELINE_LUTS) throw new Error(`A timeline keeps up to ${MAX_TIMELINE_LUTS} custom LUTs. Reuse one by name.`);
        next = { ...next, luts }; look = `custom:${id}`;
      } else if (input.look) {
        const custom = next.luts?.find(lut => lut.name === input.look || `custom:${lut.id}` === input.look);
        look = custom ? `custom:${custom.id}` : input.look;
      }
      if (!input.clear && !look) throw new Error('Give a look, a cube file, or clear:true.');
      for (const id of input.clipIds) { const clip = find(next, id); next = patchClip(next, clip.id, { lut: input.clear ? undefined : { look: look!, amount: input.amount ?? 1 } }); }
      // Drop custom LUTs no clip uses any more.
      const used = new Set(next.clips.flatMap(clip => clip.lut?.look.startsWith('custom:') ? [clip.lut.look.slice(7)] : []));
      return next.luts ? { ...next, luts: next.luts.filter(lut => used.has(lut.id)) } : next;
    }) }),
    addTransition: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addTransition, description: `Add a transition across the cut between two touching video/image clips on the same V layer (fromClipId ends exactly where toClipId starts). preset: ${TRANSITION_PRESETS.join(', ')}. duration is seconds, snapped to whole frames (at least 2) and limited by the footage around the cut; whip-pan takes frames instead (default 4) plus whipDirection, travel and blur; direction is for spin-zoom, wipeDirection for gradient-wipe, centerX/centerY/shape/softness for iris and gradient wipes. When to use each and its settings: readSkill transitions. Returns transitionClipId; moving or deleting a connected clip removes the transition when its cut disappears.`, inputSchema: z.object({ fromClipId: z.string().min(1), toClipId: z.string().min(1), preset: z.enum(TRANSITION_PRESETS), duration: z.number().min(.1).max(3).optional(), direction: z.enum(TRANSITION_DIRECTIONS).optional(), wipeDirection: z.enum(WIPE_DIRECTIONS).optional(), whipDirection: z.enum(WHIP_DIRECTIONS).optional(), travel: z.number().min(WHIP_TRAVEL.min).max(WHIP_TRAVEL.max).optional(), frames: z.number().int().min(WHIP_FRAMES.min).max(WHIP_FRAMES.max).optional(), blur: z.number().min(0).max(WHIP_BLUR_MAX).optional(), softness: z.number().min(0).max(1).optional(), centerX: z.number().min(0).max(1).optional(), centerY: z.number().min(0).max(1).optional(), shape: z.enum(IRIS_SHAPES).optional() }).strict().refine(input => input.preset === 'whip-pan' || (input.whipDirection === undefined && input.travel === undefined && input.frames === undefined && input.blur === undefined), { message: 'whipDirection, travel, frames and blur belong to whip-pan.' }).refine(input => input.frames === undefined || input.duration === undefined, { message: 'Give frames or duration, not both.' }), execute: async (_ctx, { fromClipId, toClipId, preset, frames, ...options }) => {
      if (frames !== undefined) options.duration = frames / 30;
      const transitionClipId = crypto.randomUUID();
      const saved = await checkpoint(t => addTransitionClip(t, transitionClipId, preset, fromClipId, toClipId, options));
      return { ...saved, transitionClipId };
    } }),
    addImpactFrame: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addImpactFrame, description: "Add a frame-exact hit look at TIMELINE time at. Give exactly one of frames (whole project frames) or duration (seconds, snapped to the frame grid), from one frame to 30 seconds. Presets invert, black-white, posterize, manga. Optional intensity, threshold, levels, radial speedLines, flash and centerX/Y. Applies to footage on all V layers during this range; no source/audio retiming. Returns effectClipId. Read vfx for montage timing.", inputSchema: impactSettingsSchema.partial().extend({ at:z.number().min(0), frames:z.number().int().positive().optional(), duration:z.number().positive().max(30).optional() }).strict(), execute:async(_ctx,{at,frames,duration,...settings})=>{
      const effectClipId=crypto.randomUUID();
      const saved=await checkpoint(t=>patchClip(addEffectClip(t,effectClipId,'impact-frame',at,{duration:vfxDuration(t.fps,frames,duration)}),effectClipId,{impact:{...DEFAULT_IMPACT,...settings}}));
      return {...saved,effectClipId};
    }}),
    configureImpactFrame: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureImpactFrame, description:"Adjust an existing impact-frame FX. Omitted settings and timing stay intact. frames or duration changes its length; use moveClips to change its timeline time. Delete the FX to remove it.",inputSchema:impactSettingsSchema.partial().extend({clipId:z.string().min(1),frames:z.number().int().positive().optional(),duration:z.number().positive().max(30).optional()}).strict(),execute:async(_ctx,{clipId,frames,duration,...settings})=>checkpoint(t=>{
      const clip=find(t,clipId);if(clip.effectPreset!=='impact-frame')throw new Error('Choose an impact-frame FX.');
      return patchClip(t,clipId,{impact:{...DEFAULT_IMPACT,...clip.impact,...settings},...(frames!==undefined||duration!==undefined?{duration:vfxDuration(t.fps,frames,duration)}:{})});
    })}),
    addOverlay: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addOverlay,description:"Add an original procedural light-leak, film-burn, lens-flare, dust or grain overlay across a TIMELINE span, after any speech cut. Set at to cutTime-duration/2 to bridge a cut. Give frames or duration (one frame to 30 seconds), blend screen/add/overlay, intensity 0..1, color, deterministic seed, speed 0..4, and fade 0..0.5 (fraction at each end, 0 holds full intensity). No downloaded assets or external licenses. Shared preview/export renderer. Returns effectClipId.",inputSchema:overlaySettingsSchema.partial().extend({at:z.number().min(0),frames:z.number().int().positive().optional(),duration:z.number().positive().max(30).optional()}).strict(),execute:async(_ctx,{at,frames,duration,...settings})=>{
      const effectClipId=crypto.randomUUID();
      const saved=await checkpoint(t=>patchClip(addEffectClip(t,effectClipId,'texture-overlay',at,{duration:vfxDuration(t.fps,frames,duration)}),effectClipId,{overlay:{...DEFAULT_OVERLAY,...settings}}));
      return {...saved,effectClipId};
    }}),
    configureOverlay:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureOverlay,description:"Change a procedural texture-overlay FX preset, blend, intensity, color, seed, speed or fade. Optional frames or duration changes its length. Preserve every omitted control and all other clips.",inputSchema:overlaySettingsSchema.partial().extend({clipId:z.string().min(1),frames:z.number().int().positive().optional(),duration:z.number().positive().max(30).optional()}).strict(),execute:async(_ctx,{clipId,frames,duration,...settings})=>checkpoint(t=>{
      const clip=find(t,clipId);if(clip.effectPreset!=='texture-overlay')throw new Error('Choose a texture-overlay FX.');
      return patchClip(t,clipId,{overlay:{...DEFAULT_OVERLAY,...clip.overlay,...settings},...(frames!==undefined||duration!==undefined?{duration:vfxDuration(t.fps,frames,duration),overlayTiming:{duration:vfxDuration(t.fps,frames,duration),offset:0}}:{})});
    })}),
    freezeFrameParallax:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.freezeFrameParallax,description:"Freeze a video frame at TIMELINE at, then add a 2.5D camera move of .2 to 10 seconds. mode insert ripples later clips and markers; hold replaces the picture while audio continues. Paid fal depth, matting and inpainting on the media worker; optional seed picks the subject (point, box, inspectFrames target or noun), backgroundPrompt describes the EMPTY environment. amount, panX/panY, orbit and zoom shape the move. Check the mask on gameplay. Returns stillClipId; can take several minutes, and a retry reuses a finished result.",inputSchema:parallaxSettingsSchema.partial().extend({clipId:z.string().min(1),at:z.number().min(0),duration:z.number().min(.2).max(10),mode:z.enum(FREEZE_MODES).optional(),backgroundPrompt:z.string().trim().min(1).max(500).optional(),seed:pixelSeedInput.optional()}).strict(),execute:async(_ctx,{clipId,at,duration,mode,backgroundPrompt,seed,...settings})=>reportAnalysisFailure(async()=>{
      await editSession.wait();const clip=find(editSession.timeline,clipId);
      if(clip.kind!=='video'||!clip.assetId)throw new Error('Choose a video clip.');
      const frame=1/editSession.timeline.fps;
      if(at<clip.start||at>clip.start+clip.duration)throw new Error('Choose a freeze time inside this clip.');
      const snappedAt=Math.round(at*editSession.timeline.fps)/editSession.timeline.fps;
      const time=sourceTimeAt(clip,Math.min(snappedAt,clip.start+clip.duration-frame));
      const started=await derive({clipId,assetId:clip.assetId,op:'parallax',start:time,end:time,time,...(seed?{selection:{time,seed:resolveSubjectSeed(seed,clip.assetId,time)}}:{}),...(backgroundPrompt?{backgroundPrompt}:{}),placeLater:false});
      const atlas=started.status==='completed'&&started.outputAssetId?await adoptAsset(started.outputAssetId):await awaitDerivation(started.derivationId,7*60_000);
      const stillClipId=crypto.randomUUID(),splitIds=[crypto.randomUUID(),crypto.randomUUID()];
      const saved=await checkpoint(t=>{
        let allocation=0;
        const next=insertFreezeFrame(t,clipId,snappedAt,duration,mode??'insert',atlas._id,()=>allocation++===0?stillClipId:splitIds[allocation-2]);
        return patchClip(next,stillClipId,{parallax:{...DEFAULT_PARALLAX,...settings,duration:find(next,stillClipId).duration}});
      });
      return {...saved,stillClipId,models:{depth:'Depth Anything V2',foreground:seed?'SAM2 selected subject':'BiRefNet V2 with SAM2 fallback',background:'SDXL inpainting'},inference:'fal.ai via media worker',estimatedUsd:started.estimatedUsd};
    })}),
    configureParallax:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureParallax,description:"Adjust the virtual camera of a prepared parallax freeze image without rerunning models. amount 0..0.12, panX/Y -1..1, orbit -8..8 degrees and zoom 1..1.3. Its existing hold length stays intact.",inputSchema:parallaxSettingsSchema.omit({duration:true}).partial().extend({clipId:z.string().min(1)}).strict(),execute:async(_ctx,{clipId,...settings})=>checkpoint(t=>{const clip=find(t,clipId);if(!clip.parallax)throw new Error('Choose a prepared parallax freeze.');return patchClip(t,clipId,{parallax:{...clip.parallax,...settings}});})}),
    freezeFrame: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.freezeFrame, description: "Freeze one video clip's picture at a timeline moment, as a still that keeps the clip's framing, crop and look. mode insert (default): the timeline grows by `duration`; everything from that moment on (all layers, markers) moves later, then the clip resumes. mode hold: the picture holds for `duration` while the clip's sound plays on, then the video resumes in sync (skipping the held footage). Classic uses: freeze on a reaction or punchline and add a caption, label or zoom on the still (it is an image clip; animateClip, setVisualEffects and text work on it). Takes a few seconds. Returns stillClipId.", inputSchema: z.object({ clipId: z.string().min(1), at: z.number().min(0).describe('Timeline seconds inside the clip'), duration: z.number().min(MIN_FREEZE_SECONDS).max(MAX_FREEZE_SECONDS), mode: z.enum(FREEZE_MODES).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId);
      if (clip.kind !== 'video' || !clip.assetId) throw new Error('Freeze a video clip.');
      if (input.at < clip.start - 1e-6 || input.at > clip.start + clip.duration + 1e-6) throw new Error(`Choose a time between ${clip.start.toFixed(2)} and ${(clip.start + clip.duration).toFixed(2)}.`);
      const frame = 1 / editSession.timeline.fps, time = sourceTimeAt(clip, Math.min(input.at, clip.start + clip.duration - frame));
      const started = await derive({ clipId: clip.id, assetId: clip.assetId, op: 'freeze', start: time, end: time, time, placeLater: false });
      const still = started.status === 'completed' && started.outputAssetId ? await adoptAsset(started.outputAssetId) : await awaitDerivation(started.derivationId, 120_000);
      let stillClipId = '';
      const saved = await checkpoint(t => insertFreezeFrame(t, input.clipId, input.at, input.duration, input.mode ?? 'insert', still._id, () => { const id = crypto.randomUUID(); if (!stillClipId) stillClipId = id; return id; }));
      return { ...saved, stillClipId };
    }) }),
    smoothSlowMotion: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.smoothSlowMotion, description: "Make slow motion smooth: AI frame interpolation (fal.ai RIFE) generates the in-between frames, so a slowed clip plays fluidly instead of stuttering. Optionally set a constant `rate` (0.25..1) in the same call; otherwise it uses the clip's current speed or speed ramp (its slowest point decides how many frames to add, up to 8x). Up to 30 seconds of footage. Runs in the background for about 1-3 minutes and costs the user's fal.ai credit; the clip switches to the smooth footage automatically after this turn's edits are saved. Use when the user asks for smooth or buttery slow-mo, or after a strong slow-down (0.5x or slower) on fast action.", inputSchema: z.object({ clipId: z.string().min(1), rate: z.number().min(.25).max(1).optional() }).strict(), execute: async (_ctx, input) => {
      let saved: Awaited<ReturnType<typeof checkpoint>> | undefined;
      if (input.rate !== undefined) saved = await checkpoint(t => setClipPlaybackRate(t, input.clipId, input.rate!));
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId);
      if (clip.kind !== 'video' || !clip.assetId) throw new Error('Choose a video clip.');
      const slowest = clip.speedRamp?.length ? Math.min(...clip.speedRamp.map(point => point.v)) : playbackRateOf(clip);
      if (slowest > .8) throw new Error('This clip plays near normal speed, so it needs no extra frames. Slow it down first (rate, or setSpeedRamp).');
      const factor = Math.min(8, Math.max(2, Math.ceil(1 / slowest - 1e-6)));
      const started = await derive({ clipId: clip.id, assetId: clip.assetId, op: 'slowmo', start: clip.sourceStart, end: sourceEndOf(clip), factor, fps: editSession.timeline.fps, placeLater: true });
      if (started.status === 'completed' && started.outputAssetId) { await adoptAsset(started.outputAssetId); saved = await checkpoint(t => patchClip(t, clip.id, { assetId: started.outputAssetId! })); return { ...saved, applied: true, reusedExisting: true, factor, estimatedUsd: 0 }; }
      return { ...(saved ?? {}), started: true, factor, estimatedUsd: started.estimatedUsd, note: 'Frame interpolation is processing; the clip switches to the smooth footage automatically when it finishes.' };
    } }),
    upscaleClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.upscaleClip, description: "AI-upscale low-resolution footage or an image (fal.ai) so it stays sharp in a 1080p or 4K export: for small screen recordings, old clips, zoomed-in crops or low-res images. `target` is the short side in pixels (1080 default, 1440 or 2160). Video: up to 60 seconds of the clip's footage, about 2-5 minutes in the background, costs the user's fal.ai credit (quoted as estimatedUsd), and the clip switches automatically after this turn's edits are saved. Images switch the same way. Refuses media that is already at least the target size.", inputSchema: z.object({ clipId: z.string().min(1), target: z.union([z.literal(1080), z.literal(1440), z.literal(2160)]).optional() }).strict(), execute: async (_ctx, input) => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId), target = input.target ?? 1080;
      if ((clip.kind !== 'video' && clip.kind !== 'image') || !clip.assetId) throw new Error('Upscale a video or image clip.');
      const asset = await loadAsset(clip.assetId);
      if (asset.width && asset.height && Math.min(asset.width, asset.height) >= target) throw new Error(`This media is already ${asset.width}x${asset.height}, at least ${target}p. It needs no upscale.`);
      const started = await derive({ clipId: clip.id, assetId: clip.assetId, op: 'upscale', start: clip.kind === 'video' ? clip.sourceStart : 0, end: clip.kind === 'video' ? sourceEndOf(clip) : 0, target, fps: editSession.timeline.fps, placeLater: true });
      if (started.status === 'completed' && started.outputAssetId) { await adoptAsset(started.outputAssetId); const saved = await checkpoint(t => patchClip(t, clip.id, { assetId: started.outputAssetId! })); return { ...saved, applied: true, reusedExisting: true, estimatedUsd: 0 }; }
      return { started: true, estimatedUsd: started.estimatedUsd, note: 'Upscaling is processing; the clip switches to the sharper media automatically when it finishes.' };
    } }),
    setPlaybackRate: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setPlaybackRate, description: "Change a video or audio clip’s constant playback speed from 0.25× to 4×. Preserve its retained source footage; adjust timeline duration and linked sound together. Slowing down refuses overlaps, so make room first rather than moving unrelated clips. This is constant speed, not a speed ramp.", inputSchema: z.object({ clipId: z.string(), rate: z.number().min(.25).max(4) }), execute: async (_ctx, input) => checkpoint(t => setClipPlaybackRate(t, input.clipId, input.rate)) }),
    resetVisualEffect:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.resetVisualEffect,description:"Reset one requested footage effect group to defaults (retain its enabled state) or remove that group. Preserve every other group, clip and audio. Resetting dither restores the original RGB colors.",inputSchema:z.object({clipId:z.string(),effect:z.enum(OFFERED_VISUAL_EFFECT_GROUPS),action:z.enum(['reset','remove'])}),execute:async(_ctx,{clipId,effect,action})=>checkpoint(t=>patchClip(t,clipId,visualEffectActionPatch(find(t,clipId),effect,action)))}),
    applyTextTemplate: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyTextTemplate, description: "Apply a text template animation (Word reveal, Pop-in words, Sliding title, Karaoke, Neon Echo, Lyric Slam, Kinetic Stack, Chromatic split, Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on, Echo tunnel) to a caption or graphic, keeping its words, appearance, font, position, rotation and timing. These are animations, not looks: a look is applyTextLook. Karaoke uses saved word timings when present, otherwise even progress. What each looks like: readSkill footage-editing page text-styling.", inputSchema: z.object({ clipId: z.string(), preset: z.enum(TEXT_TEMPLATE_PRESETS) }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); return patchClip(t, clip.id, textTemplatePatch(clip, input.preset)); }) }),
    configureTextTemplate: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureTextTemplate, description: "Change a caption or graphic text template's highlight/accent color, karaokeStyle (box or pop), or animation controls, or choose another supported template. strength, revealDuration and stagger apply to Chromatic split, Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on and Echo tunnel. Colors are six-digit hex. Words, timing, duration, appearance, rotation, outer animation and omitted controls are kept; control-only edits keep the animation clock, a different preset restarts its entrance. Saves immediately.", inputSchema:z.object({clipId:z.string(),preset:z.enum(TEXT_TEMPLATE_PRESETS).optional(),highlightColor:z.string().regex(/^#[\da-f]{6}$/i).optional(),karaokeStyle:z.enum(['box','pop']).optional(),strength:z.number().min(.2).max(2).optional(),revealDuration:z.number().min(.15).max(3).optional(),stagger:z.number().min(0).max(.18).optional()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a text template, highlight color or animation control.'}),execute:async(_ctx,{clipId,preset,...changes})=>checkpoint(t=>{
      const clip=find(t,clipId);if(clip.kind!=='caption'&&clip.kind!=='graphic')throw new Error('Choose a caption or text graphic.');
      const patch=preset&&preset!==clip.textTemplate?.preset?textTemplatePatch(clip,preset):{},template=patch.textTemplate??clip.textTemplate;
      if(!template)throw new Error('Choose a text template before changing its appearance or animation controls.');
      return patchClip(t,clipId,{...patch,textTemplate:{...template,...changes}});
    })}),
    addTimedEffect: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.addTimedEffect, description: `Add an independent FX clip for an explicit effect request or authorized creative styling: ${OFFERED_TIMED_EFFECT_PRESETS.map(preset=>EFFECT_CATALOG[preset].label).join(', ')}. solid-color adds a normal V color layer instead (below footage for a background, above it for an overlay). start (default the playhead) and duration are timeline seconds; controls must match the preset (zoom for the Zoom family, punch, flash, shake, solidColor), and omitted ones keep their values. One planId maps to one FX clip with the same start and full duration. Footage fades are configureVisualFade, sound fades configureAudio and a cut between neighbours addTransition, never a fade FX. Controls and examples: readSkill footage-editing page effect-tools.`, inputSchema: z.object({ planId:z.string().optional(),preset:z.enum(OFFERED_TIMED_EFFECT_PRESETS),start:z.number().min(0).optional(),duration:z.number().positive().optional(),aboveClipId:z.string().optional(),solidColor:solidColorInput.optional(),zoom:zoomInput.optional(),...pulseInputs }).strict().refine(input=>!input.zoom||isZoomPreset(input.preset),{message:'Zoom controls belong to Zoom FX.'}).refine(input=>!input.solidColor||input.preset==='solid-color',{message:'Solid color controls belong to solid-color FX.'}).refine(input=>!input.flash||input.preset==='flash',{message:'Flash controls require flash FX.'}).refine(input=>!input.shake||input.preset==='shake',{message:'Shake controls require shake FX.'}).refine(input=>!input.punch||input.preset==='punch',{message:'Controls must match the requested effect preset.'}), execute:async(_ctx,input)=>checkpoint(t=>{
      const start=input.start??options.playhead??0,plan=effectPlans.find(plan=>(!input.planId||plan.id===input.planId)&&plan.kind==='timed'&&plan.effect===input.preset&&Math.abs(plan.start-start)<1/t.fps);
      if(!plan&&!options.planlessEffects&&recipe().fullTools&&laneToolAllowed(lane,'planEffects',[...capabilities]))throw stepOrderGuard('Record this effect with planEffects before adding it.');
      if(plan&&Math.abs((input.duration??plan.duration)-plan.duration)>1/t.fps)throw new Error('Match the timed plan duration to this one FX clip. Plan each separate pulse with its own ID and range.');
      const duration=input.duration??plan?.duration;if(duration===undefined)throw new Error('Give the effect a duration in seconds.');
      const id=crypto.randomUUID();if(plan)planBindings.set(plan.id,id);
      const next=addEffectClip(t,id,input.preset,start,{duration,aboveClipId:input.aboveClipId});
      if(input.zoom)return patchClip(next,id,configureTimedEffectPatch(find(next,id),{zoom:input.zoom}));
      if(input.solidColor)return patchClip(next,id,solidColorPatch(find(next,id),input.solidColor));
      return input.punch||input.flash||input.shake?patchClip(next,id,configureTimedEffectPatch(find(next,id),{punch:input.punch,flash:input.flash,shake:input.shake})):next;
    })}),
    convertSolidColorToVisual:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.convertSolidColorToVisual,description:"Move an existing saved solid-color FX rectangle to a normal V layer so it can be placed behind or above footage. Preserve its color, size, position, opacity, timing and motion. Use only when the user wants that solid on a visual layer or behind footage. Already-normal V colors are unchanged.",inputSchema:z.object({clipId:z.string()}),execute:async(_ctx,{clipId})=>checkpoint(t=>convertSolidColorToVisual(t,clipId))}),
    setSolidColor:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setSolidColor,description:"Configure an existing solid-color V layer or saved legacy FX frame/rectangle's requested color, normalized width/height/center x/y or opacity. Width/height are fractions of output dimensions (1 fills that axis); x/y0.5 is centered. Preserve omitted controls and all footage/audio. Saves immediately.",inputSchema:solidColorInput.extend({clipId:z.string()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a solid color control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>patchClip(t,clipId,solidColorPatch(find(t,clipId),changes)))}),
    configureTimedEffect:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.configureTimedEffect,description:"Change an existing timed FX: switch it to another supported preset, stretch its duration, or tune its preset's controls (punch, zoom). Omitted controls, the clip start and all other footage, FX and audio are kept. Solid-color settings use setSolidColor. New footage or sound fades use configureVisualFade and configureAudio, never FX. Controls: readSkill footage-editing page effect-tools.",inputSchema:z.object({clipId:z.string(),preset:z.enum(OFFERED_TIMED_EFFECT_PRESETS).optional(),duration:z.number().positive().optional(),...pulseInputs,zoom:zoomInput.optional()}).strict().refine(input=>input.preset!==undefined||input.duration!==undefined||input.zoom!==undefined||input.punch!==undefined||input.flash!==undefined||input.shake!==undefined,{message:'Specify a timed effect control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>patchClip(t,clipId,configureTimedEffectPatch(find(t,clipId),changes)))}),
    applyMotionPreset: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyMotionPreset, description: "Set a caption or text graphic's animation: none, fade, rise, or pop. Text animation only; use setVisualEffects for footage color, zoom blur or glitch when effects or creative styling are requested. Saves immediately.", inputSchema: z.object({ clipId: z.string(), preset: z.enum(TEXT_EFFECT_PRESETS) }), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      return patchClip(t, clip.id, textEffectPatch(clip, input.preset));
    }) }),
    animateClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.animateClip, description: "Animate a whole object on the canvas (video clip, caption, text graphic, uploaded image or solid color): move, scale, rotate, fade, brighten. One clipId with keyframes, or objects:[{clipId,keyframes,replaceMotion?}] for several in one atomic edit. keyframes use CLIP-LOCAL seconds; x/y are offsets in canvas fractions from the static placement, scale and opacity multiply, rotation is degrees, brightness 1 is unchanged. Eased paths take 2–8 anchors, linear paths 0–120 points. Replaces only this object's custom motion; a prior camera or smooth-zoom recipe needs the user's permission and replaceMotion:true. Pushing or panning inside footage is configureSmoothZoom or configureCameraMotion. Details and examples: readSkill footage-editing page effect-tools.", inputSchema:objectMotionInput.partial().extend({objects:z.array(objectMotionInput).min(1).max(32).optional()}).strict().refine(input=>input.objects!==undefined?input.clipId===undefined&&input.keyframes===undefined&&input.replaceMotion===undefined:input.clipId!==undefined&&input.keyframes!==undefined,{message:'Send one clipId with keyframes, or an objects batch, not both.'}), execute:async(_ctx,input)=>checkpoint(t=>animateObjects(t,input.objects??[{clipId:input.clipId!,keyframes:input.keyframes!,replaceMotion:input.replaceMotion}])) }),
    cropClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.cropClip, description: "Set requested crop edge amounts on a video/image. units defaults normalized source-axis fractions; units pixels uses recorded intrinsic asset width for left/right and height for top/bottom. Require known positive source dimensions for pixels; never invent source geometry. Opposing edges must leave more than 5% per axis. Preserve omitted edges, source placement/fitted size, transform, fit, volume and timing; crop masks without zooming the source.", inputSchema: z.object({ clipId: z.string(),units:z.enum(VISUAL_INPUT_UNITS).optional(), top: z.number().min(0).optional(), right: z.number().min(0).optional(), bottom: z.number().min(0).optional(), left: z.number().min(0).optional() }), execute: async (_ctx, input) => checkpoint(t => {
      const {clipId,units,...changes}=input;const clip=find(t,clipId),asset=assets.find(asset=>asset._id===clip.assetId);
      return patchClip(t,clipId,cropInputPatch(clip,changes,asset??{},units));
    }) }),
    applyLayout:createTool({ metadata: EDITOR_TOOL_DEFINITIONS.applyLayout,description:"Apply a composition preset to exact existing video/image clips, keeping source ranges, timing, sound and other clips. two-rows: topClipIds (supporting footage) and bottomClipIds (narrator), each row half the canvas; detectedRegions:true uses saved facecam rectangles. mirror-blur (clipIds): a wide clip on a taller canvas stays sharp at full width (its crop and position are replaced) with blurred, darkened, mirrored bands of its own frames above and below; a clip setting, never copies or extra layers. blur and darken tune it, remove:true takes it off, foldStacked:true without clipIds folds older stacked copies in the tab. Refuses a source already filling the canvas height, and clips with custom object motion or legacy follow crop until that is resolved. Details: readSkill footage-editing page effect-tools.",inputSchema:z.object({layout:z.enum(['two-rows','mirror-blur']),detectedRegions:z.boolean().optional(),topClipIds:z.array(z.string().min(1)).max(100).optional(),bottomClipIds:z.array(z.string().min(1)).max(100).optional(),clipIds:z.array(z.string().min(1)).max(100).optional().describe('mirror-blur only: the clips that stay sharp in the middle.'),blur:z.number().min(MIRROR_FILL_LIMITS.blur[0]).max(MIRROR_FILL_LIMITS.blur[1]).optional().describe('mirror-blur only: band blur in design pixels.'),darken:z.number().min(MIRROR_FILL_LIMITS.darken[0]).max(MIRROR_FILL_LIMITS.darken[1]).optional().describe('mirror-blur only: exposure stops the bands are darkened by.'),remove:z.boolean().optional().describe('mirror-blur only: take the background off clipIds.'),foldStacked:z.boolean().optional().describe('mirror-blur only: convert old stacked mirror copies into the backgroundFill setting; without clipIds, every stacked group in the tab.')}),execute:async(_ctx,{layout,topClipIds=[],bottomClipIds=[],clipIds=[],detectedRegions,blur,darken,remove,foldStacked})=>{if(layout==='mirror-blur'){if(topClipIds.length||bottomClipIds.length||detectedRegions)throw new Error('mirror-blur takes clipIds only; topClipIds, bottomClipIds and detectedRegions belong to two-rows.');if(!clipIds.length&&!foldStacked)throw new Error('Choose clipIds for the mirror blur layout, or foldStacked:true to convert every stacked group.');if(remove&&(blur!==undefined||darken!==undefined||foldStacked))throw new Error('remove takes clipIds only.');let folded:Record<string,string[]>={};const saved=await checkpoint(t=>{if(remove){for(const id of clipIds)if(!find(t,id).backgroundFill)throw new Error(`Clip ${id} has no mirror blur background.`);return {...t,clips:t.clips.map(clip=>clipIds.includes(clip.id)?Object.fromEntries(Object.entries(clip).filter(([key])=>key!=='backgroundFill')) as Clip:clip)};}const result=!clipIds.length?foldMirrorBlurStacks(t):applyMirrorBlurLayout(t,assets,clipIds,{blur,darken});folded=result.folded;return result.timeline;});const ids=clipIds.length?clipIds:Object.keys(folded);return {...saved,backgroundFill:Object.fromEntries(ids.map(id=>[id,find(editSession.timeline,id).backgroundFill??null])),addedClips:0,...(Object.keys(folded).length?{foldedCopyClipIds:folded}:{})};}if(clipIds.length)throw new Error('two-rows takes topClipIds and bottomClipIds, not clipIds.');if(topClipIds.length+bottomClipIds.length===0)throw new Error('Choose footage for at least one row.');if(detectedRegions)for(const id of new Set([...topClipIds,...bottomClipIds].map(id=>find(editSession.timeline,id).assetId))){if(!id)throw new Error('Choose source footage.');await analyze(id,'facecam');}return checkpoint(t=>applyTwoRowLayout(t,assets,{topClipIds,bottomClipIds,detectedRegions}));}}),
    fitClip: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.fitClip, description: "Fit a video/image into its frame (contain, preserving the complete source) or fill the frame (cover, cropping overflow); save immediately.", inputSchema: z.object({ clipId: z.string(), fit: z.enum(["cover", "contain"]) }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (clip.kind !== "video" && clip.kind !== "image") throw new Error("Choose a video or image"); return patchClip(t, clip.id, { fit: input.fit }); }) }),
    resetVisual: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.resetVisual, description: "Reset a video/image's position, scale, rotation, opacity, flip, and edge crop to defaults; save immediately.", inputSchema: z.object({ clipId: z.string() }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (clip.kind !== "video" && clip.kind !== "image") throw new Error("Choose a video or image"); return patchClip(t, clip.id, { transform: undefined, crop: undefined, fit: undefined, flip: undefined }); }) }),
    setAspectRatio: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.setAspectRatio, description: "Set the canvas aspect ratio; save immediately.", inputSchema: z.object({ aspectRatio: z.enum(aspectRatioValidator.members.map(member => member.value)) }), execute: async (_ctx, input) => checkpoint(t => ({ ...t, aspectRatio: input.aspectRatio })) }),
    followSubject: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.followSubject, description: "Subject-follow crop on a video clip. mode active-speaker holds the dominant face per camera shot and switches only on confirmed speaker turns (diarized words, mouth activity, remembered faces), analyzing the retained SOURCE window up to 120 s and reusing saved analysis. enabled:false turns follow crop off at once. Keeps source, timing and other crop and transform controls. Returns retained seconds and heuristic confidence per method; when every interval is uncertain it returns applied:false and applies no crop.", inputSchema: z.object({ clipId: z.string(),enabled:z.boolean().optional(),mode:z.enum(['face','active-speaker']).optional() }), execute: async (_ctx, input) => {
      if(input.enabled===false)return checkpoint(t=>{const clip=find(t,input.clipId);if(clip.kind!=='video')throw new Error('Choose a video clip.');return patchClip(t,clip.id,{focus:undefined,framingCuts:undefined})});
      const selected = find(editSession.timeline, input.clipId); const source = selected.assetId?await loadAsset(selected.assetId):undefined;
      if (selected.kind !== "video" || !source) throw new Error("Choose an uploaded video clip");
      if(input.mode==='active-speaker'){
        const evidence=await analyze(source._id,'speakers',false,{start:selected.sourceStart,end:Math.min(source.duration??sourceEndOf(selected),sourceEndOf(selected))}),speakers=evidence.analysis?.speakers;
        const framing=speakers?summarizeSpeakerFraming(speakers,selected.sourceStart,sourceEndOf(selected),time=>timelineTimeAtSource(selected,time)):null;
        if(!speakers||!framing?.some(row=>row.method!=='fallback'&&row.seconds>0))return {applied:false,reason:'No confident shot framing or visible speaker match. Keep a stable wider view.',framing};
        const saved=await checkpoint(t=>{const clip=find(t,input.clipId);if(clip.motion?.length)throw new Error('Resolve existing custom camera motion before following speakers.');return patchClip(t,clip.id,{focus:focusForClip(speakers.focus,clip),framingCuts:speakers.version===2?speakers.framing.filter((f,i,all)=>!i||f.shot!==all[i-1].shot||f.faceId!==all[i-1].faceId).map(f=>f.start):speakers.turns.filter((f,i,all)=>!i||f.speaker!==all[i-1].speaker).map(f=>f.start)});});
        return {...saved,framing,framingTimeBasis:'retained timeline seconds',confidenceBasis:'Duration-weighted framing evidence, not a calibrated voice-identity probability. Shot dominance does not identify the voice.'};
      }
      if (!source.analysis?.focus?.length) await analyze(source._id, "track");
      return checkpoint(t => { const clip = find(t, input.clipId); const asset = assets.find(current => current._id === clip.assetId); if (clip.kind !== "video" || !asset?.analysis?.focus?.length) throw new Error("No visible subject was detected in this video"); return patchClip(t, input.clipId, { focus: focusForClip(asset.analysis.focus, clip) }); });
    } }),
    removeBackground: createTool({ metadata: EDITOR_TOOL_DEFINITIONS.removeBackground, description: "Ultra only. Remove the background of a video clip. mode person (default) uses fal person matting with soft hair edges; mode foreground uses BiRefNet V2 to keep salient foreground content, including objects or game characters. Optional seed uses the same point, box, object noun or inspected target as trackPoints. time is the TIMELINE seed second (defaults to clip start). Florence-2 grounds nouns, and SAM2 segments the selected subject. Automatic BiRefNet falls back to SAM2 if empty. Inspect the matte. Runs in the media worker using fal credit; the clip switches to transparent WebM after the edit finishes. Put text or replacement visuals on a lower V layer.", inputSchema: z.object({ clipId: z.string().min(1), mode: z.enum(['person','foreground']).optional(), seed: pixelSeedInput.optional(), time:z.number().nonnegative().optional() }).strict(), execute: async (_ctx, { clipId, mode, seed, time }) => {
      await editSession.wait();const clip=find(editSession.timeline,clipId);
      const at=time??clip.start;
      if(at<clip.start||at>=clip.start+clip.duration)throw new Error('Choose a subject seed time inside the clip.');
      const sourceTime=sourceTimeAt(clip,at);
      const result = await ctx.runMutation(internal.cutouts.startFromRun, { ...run, clipId, ...(mode ? { mode } : {}), ...(seed?{selection:{time:sourceTime,seed:resolveSubjectSeed(seed,clip.assetId,sourceTime)}}:{}) });
      // A reused cut-out goes on through this run's edit session, so a staged draft keeps it.
      if (result.reused && result.outputAssetId) { const outputAssetId = result.outputAssetId; await checkpoint(t => ({ ...t, clips: t.clips.map(item => item.id === clipId ? { ...item, assetId: outputAssetId } : item) })); }
      return result.reused ? { applied: true, reusedExistingCutOut: true, estimatedUsd: 0, note: 'An existing cut-out of this footage was applied; the background is already removed. Visuals belong on a lower V layer.' } : { started: !result.alreadyRunning, alreadyRunning: result.alreadyRunning, estimatedUsd: result.estimatedUsd, note: 'Background removal is processing; the clip switches to the cut-out automatically when it finishes. Visuals belong on a lower V layer.' };
    } }),
  };
  // Track which tools are running or staged an edit, for editingTools above. createTool's execute reads its ctx from `this`.
  for (const [name, tool] of Object.entries(tools) as [string, { execute?: (...args: never[]) => Promise<unknown> }][]) {
    const execute = tool.execute;
    if (!execute) continue;
    tool.execute = async function (this: unknown, ...args: never[]) {
      const input = (args[0] ?? {}) as { mode?: string; name?: string; page?: string; start?: number; end?: number; clipId?: string; times?: number[]; count?: number; fps?: number; stillsOnly?: boolean; momentsOnly?: boolean };
      if (!recipe().fullTools && FULL_CHECK_TOOLS.has(name)) return { success: false, error: fullCheckRefusal(lane, name) };
      const batchedReelStills = lane === 'reel' && input.stillsOnly === true && input.fps === undefined && !input.momentsOnly && (input.times ? input.times.length <= 30 : (input.count ?? 8) <= 12);
      // A still image is one frame: the window and sampling rules for video reads do not apply to it.
      const stillRead = name === 'readFrames' && assets.find(asset => asset._id === (input as { assetId?: string }).assetId)?.kind === 'image';
      if (recipe().boundedReads && name === 'readFrames' && !stillRead && !batchedReelStills && (input.start === undefined || input.end === undefined || input.end - input.start > 3)) return { success: false, error: BOUNDED_READ_REFUSAL };
      // An id an earlier edit of this request cut or replaced is read as the clip it became, and the result says so.
      const resolved = resolveStaleIds(editSession.timeline, args[0]);
      if (resolved.refusal) return { success: false, error: resolved.refusal };
      if (resolved.notes.length) args = [resolved.input, ...args.slice(1)] as never[];
      const before = editSession.timeline;
      runningTools.set(name, (runningTools.get(name) ?? 0) + 1);
      try {
        let output = await execute.apply(this ?? tool, args) as { staged?: unknown } | undefined;
        if (before !== editSession.timeline) recordSuccessors(before, editSession.timeline);
        if (resolved.notes.length && output && typeof output === 'object' && !Array.isArray(output)) output = { ...(output as object), staleIds: resolved.notes.join(' ') } as typeof output;
        if (output?.staged === true) stagedTools.add(name);
        if (tracksChanges() && name !== 'createTimeline' && name !== 'openTimeline' && before !== editSession.timeline) {
          const moments = recipe().frames === 'sample' ? fastReelFrameMoments(name, before, editSession.timeline) : speechCutMoments(name, before, editSession.timeline);
          // Putting an old timeline on the frame grid moves edges by a fraction of a frame and draws the same picture:
          // only what this call changed beyond that is queued for a look.
          fastReview.changed(snapTimelineToFrames(before).timeline, editSession.timeline, moments);
          return output;
        }
        return output;
      } finally {
        const left = (runningTools.get(name) ?? 1) - 1;
        if (left) runningTools.set(name, left); else runningTools.delete(name);
      }
    };
  }
  // Every editing tool takes the approved-work override. Background jobs (cut-outs, upscales, slow motion) apply
  // later, outside this check, so they refuse an approved clip up front.
  const appliedLater = new Set(['removeBackground', 'upscaleClip', 'smoothSlowMotion']);
  for (const [name, tool] of Object.entries(tools as Record<string, { execute?: (...args: never[]) => Promise<unknown>; inputSchema?: unknown }>)) {
    const execute = tool.execute;
    if (APPROVAL_FREE_TOOLS.has(name) || !execute || !(tool.inputSchema instanceof z.ZodObject)) continue;
    tool.inputSchema = tool.inputSchema.extend({ overrideApproved: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().describe('Only when the user asked for this exact change to approved work: edit it anyway. Needs overrideReason.'), overrideReason: z.string().trim().min(3).max(300).optional().describe("What the user asked, quoted, when overrideApproved is true.") });
    tool.execute = async function (this: unknown, ...args: never[]) {
      // Clients holding an older tool list send the flag as a string.
      const { overrideApproved: flag, overrideReason, ...input } = (args[0] ?? {}) as Record<string, unknown> & { overrideApproved?: boolean | string; overrideReason?: string };
      const overrideApproved = flag === true || flag === 'true';
      args = [input, ...args.slice(1)] as never[];
      if (overrideApproved && !overrideReason) throw new Error('overrideApproved needs overrideReason: quote what the user asked. Nothing was changed.');
      if (!overrideApproved && appliedLater.has(name) && typeof input.clipId === 'string') {
        await editSession.wait();
        const clip = editSession.timeline.clips.find(item => item.id === input.clipId);
        if (clip && isApproved(clip)) throw runFailure('refused', approvalRefusal([{ clipId: clip.id, name: clip.scene?.title || clip.kind, what: 'replace its media', note: clip.approval?.note ?? clip.approvedSections?.[0]?.note }]));
      }
      if (!overrideApproved) return execute.apply(this ?? tool, args);
      approvalOverride.active++; approvalOverride.reason = overrideReason!;
      const from = approvalOverride.overridden.length;
      try {
        const output = await execute.apply(this ?? tool, args);
        const overridden = approvalOverride.overridden.slice(from);
        return overridden.length && output && typeof output === 'object' ? { ...output, approvedOverridden: { reason: overrideReason, clips: overridden.map(item => ({ clipId: item.clipId, name: item.name, change: item.what })) }, note: 'Approved work was changed because the user asked. Say so in your reply; it stays approved.' } : output;
      } finally { approvalOverride.active--; }
    };
  }
  assertToolDefinitions(tools);
  // Capture actual writes after every preflight/wrapper, for both server runtimes and MCP.
  for (const [name, tool] of Object.entries(tools as Record<string, { execute?: (...args: never[]) => Promise<unknown>; toModelOutput?: (...args: never[]) => unknown }>)) {
    const execute = tool.execute;
    if (!execute) continue;
    tool.execute = function (this: unknown, ...args: never[]) {
      const instance = this && typeof this === 'object' ? this : tool;
      const supplied = 'ctx' in instance && instance.ctx && typeof instance.ctx === 'object' ? instance.ctx : {};
      const bound = { ...instance, ctx: { ...supplied, ...ctx } };
      const call=z.object({toolCallId:z.string().optional()}).parse(args[1]??{});
      return receipts.execute(name, () => editSession.revision, () => execute.apply(bound, args), async () => {
        const before=editSession.timeline;
        await editSession.reconcileSaved(() => ctx.runQuery(internal.assistant.getRunTimeline, run),true);
        if(tracksChanges())fastReview.changed(before,editSession.timeline);
      },call.toolCallId);
    };
    const serialize = tool.toModelOutput;
    if (!serialize) continue;
    tool.toModelOutput = async function (this: unknown, ...args: never[]) {
      const { output } = z.object({ output: z.record(z.string(), z.unknown()) }).parse(args[0]);
      const receipt = toolSaveReceipt(output);
      if (!receipt) return serialize.apply(this ?? tool, args);
      const envelope = { saveReceipt: receipt, saved: output.saved, unchanged: output.unchanged, staged: output.staged, revision: receipt.revision };
      if (output.success === false || output.error || output.isError === true) {
        const { images: _images, ...result } = output;
        return { type: 'json', value: result };
      }
      try {
        const rendered = z.object({ type: z.string(), value: z.unknown() }).parse(await serialize.apply(this ?? tool, args));
        if (rendered.type === 'content' && Array.isArray(rendered.value)) return { ...rendered, value: [...rendered.value, { type: 'text', text: JSON.stringify(envelope) }] };
        if (rendered.type === 'json') return { ...rendered, value: { ...z.record(z.string(), z.unknown()).parse(rendered.value), ...envelope } };
        return { type: 'json', value: { result: rendered.value, ...envelope } };
      } catch {
        const { images: _images, ...result } = output;
        return { type: 'json', value: { ...result, previewUnavailable: true, note: 'The tool result is recorded, but its preview could not be attached.' } };
      }
    };
  }
  // Observe the final receipt, including every wrapper above, in both server runtimes and MCP.
  for (const [name, tool] of Object.entries(tools as Record<string, { execute?: (...args: never[]) => Promise<unknown> }>)) {
    const execute = tool.execute;
    if (!execute || !needsSaveConfirmation(name)) continue;
    tool.execute = async function (this: unknown, ...args: never[]) {
      const revisionBefore = editSession.revision;
      const output = await execute.apply(this ?? tool, args);
      if (output && typeof output === 'object' && !Array.isArray(output)) {
        const evidence = z.object({ saved: z.unknown().optional(), unchanged: z.unknown().optional(), staged: z.unknown().optional(), revision: z.unknown().optional(), success: z.unknown().optional(), error: z.unknown().optional(), isError: z.unknown().optional() }).parse(output);
        if (evidence.success === false || evidence.error || evidence.isError === true || (evidence.staged !== true && hasSaveEvidence(evidence))) return output;
        const call = z.object({ toolCallId: z.string().optional() }).safeParse(args[1] ?? {});
        const observation = {
          ...run, ...options.publication, ...(project.threadId && !options.publication ? { threadId: project.threadId } : {}),
          source: options.publication ? 'editor' as const : 'mcp' as const, toolName: name, toolCallId: (call.success ? call.data.toolCallId : undefined) ?? crypto.randomUUID(),
          inputShape: incidentShape(args[0]), outputShape: incidentShape(output), revisionBefore, revisionAfter: editSession.revision,
          staged: evidence.staged === true, ...(typeof evidence.revision === 'number' && Number.isSafeInteger(evidence.revision) ? { stagedRevision: evidence.revision } : {}),
          observedAt: Date.now(),
        };
        // Reuse the call identity after a dropped response so a committed write is not counted twice.
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await ctx.runMutation(internal.saveIncidents.observe, observation); break; }
          catch {
            // Diagnostics must never turn a saved edit into a tool failure. No raw payload is logged.
            if (attempt === 2) console.warn(`[save-incidents] ${JSON.stringify({ event: 'observation-failed', runId: run.runId, toolName: name })}`);
          }
        }
      }
      return output;
    };
  }
  // Reports include failed edits and all timed exceptions, after the save receipt is settled.
  for (const [name, tool] of Object.entries(tools as Record<string, { execute?: (...args: never[]) => Promise<unknown> }>)) {
    const execute = tool.execute;
    if (!execute) continue;
    tool.execute = async function (this: unknown, ...args: never[]) {
      let output: unknown;
      try { output = await execute.apply(this ?? tool, args); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const data = error && typeof error === 'object' && 'data' in error ? error.data as { status?: string; message?: string } : undefined;
        if (data?.status !== 'still_queued' && !message.includes('Still queued after')) throw error;
        output = { success: false, checkPassed: false, status: 'still_queued', error: data?.message ?? message, retryAfterSeconds: 30, nextAction: { tool: name, arguments: { projectId: run.projectId, ...((args[0] ?? {}) as Record<string, unknown>) } } };
      }
      return output;
    };
  }
  const availableToolNames=():string[]=>Object.keys(tools).filter(name=>laneToolAllowed(lane,name,[...capabilities]));
  for(const [name,tool] of Object.entries(tools) as [string,{execute?:(...args:never[])=>Promise<unknown>}][]){
    const execute=tool.execute;if(!execute)continue;
    tool.execute=async function(this:unknown,...args:never[]){
      return invoke.call(this,...args);
    };
    const invoke=async function(this:unknown,...args:never[]){
      if(!laneToolAllowed(lane,name,[...capabilities]))throw new Error(laneToolError(lane,name));
      const input=(args[0]??{}) as Record<string,unknown>;
      if(name==='analyzeMedia'){
        const mode=String(input.mode),allowed=mode==='transcribe'||mode==='shots'||mode==='beats'||['track','facecam','speakers'].includes(mode);
        if(!allowed)throw new Error(`Analysis mode ${mode} is unavailable in the ${lane} lane. Use saved transcript/audio/shot signals, or loadCapability for reference work.`);
      }
      if(name==='readFrames'&&lane==='recreate'&&input.fps!==undefined){
        const asset=assets.find(asset=>asset._id===input.assetId),fps=sourceFrameRates.get(String(input.assetId))??asset?.analysis?.shots?.fps;
        if(fps&&Number(input.fps)<fps)throw new Error(`Recreation frame windows require full source fps (${fps}).`);
      }
      if(taskId){
        const task=await readTask();
        if(name==='exportVideo'&&isMcpRun(run.runId)&&!task?.exportConfirmed)throw new Error('Export needs explicit user confirmation in the current request. Ask the user before exporting.');
        // A closed task still answers finish, with its final result and what to do next: every task ends with finish,
        // and an error there read to an agent as a missing tool (issue #357). A limitation note still saves too.
        if(task?.result?.exhausted&&name==='finish'){finishResult=task.result;return {...task.result,...finishSaveState(),success:false,next:exhaustedNext(isMcpRun(run.runId))};}
        if(task?.result?.exhausted&&!EXHAUSTED_CALLABLE.has(name))throw exhaustedLaneError(lane,task.result.failures.join(' '));
        if(task?.script){scriptSaved=true;savedScript=task.script as SavedScript;}
        if(options.scriptFirst&&lane==='reel'&&!scriptSaved&&!noScript&&['retainSourceRanges','cleanSpeech','split','trim'].includes(name)&&rawTake(input.clipId))throw new Error(`Read the script before cutting this take: call readScript ${JSON.stringify({clipId:input.clipId})}, then planScript, and cut once with the ranges planScript returns.`);
        if(tracksChanges()&&task){
          const saved=readFastFrameTimes(task.evidence,timelineId,await timelineHistoryKey(editSession.timeline));
          if(saved!==undefined){fastReview.restore(saved);fastReview.fit(editSession.timeline);}
        }
        await ensureBaseline();
      }
      noteToolIntent(name);
      // Parallel tool calls of one step share the one write.
      if(taskId&&finishRequired&&!requiredPersisted){requiringFinish??=laneCtx.runMutation(internal.lanes.requireFinish,taskScope).then(()=>{requiredPersisted=true;}).finally(()=>{requiringFinish=undefined;});await requiringFinish;}
      const before=await timelineHistoryKey(editSession.timeline);
      let output:Record<string,unknown>;
      try{output=await execute.apply(this??tool,args) as Record<string,unknown>;}finally{previousTool=name;}
      const after=await timelineHistoryKey(editSession.timeline);
      if(before!==after||name==='createTimeline'||name==='openTimeline')finishResult=undefined;
      if(taskId&&tracksChanges()&&(before!==after||name==='getFrames'||name==='finish'))
        await safely('frameEvidence',()=>laneCtx.runMutation(internal.lanes.evidence,{...taskScope,evidence:fastFrameEvidence(timelineId,after,fastReview.times())}));
      if(taskId&&['checkPacing','checkSound'].includes(name)&&output?.success!==false&&before===after){
        const {images:_images,...evidence}=output;
        await laneCtx.runMutation(internal.lanes.evidence,{...taskScope,evidence:{tool:name,timelineId,fingerprint:after,input,output:evidence}});
      }
      return output;
    };
  }
  return { tools, editSession, /** A new model step: its tools read the task afresh, once. */ newStep: dropTaskReads, lane:()=>lane, laneChosen:()=>laneChosen, requiresFinish:()=>finishRequired, noteToolIntent, availableToolNames, laneFinished:()=>!!finishResult?.passed, laneFailure:()=>finishResult, publicationResult: async (output: unknown) => receipts.publishedResult(output, editSession.revision), plans: () => effectPlans, checkLevel: () => checkLevel, recipe, pendingFastFrames: () => fastReview.times(), clippingState:()=>ctx.runQuery(internal.clipping.completionState,{...clippingRun,timeline:editSession.timeline,timelineId:clippingTimelineId}),/* No turn is held open for frame fetching: finish draws its own few frames. */ fastReviewFeedback: (): string | undefined => undefined };
}
