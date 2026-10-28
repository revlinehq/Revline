import { effectPlanInput,validateEffectPlan,mergeEffectPlans,effectReviewBindings,type EffectPlan,type EffectEvidence } from '../../lib/ai/edit-plan';
import { equalTimelineValue } from '../../lib/editor/timeline-equality';
import { applyTwoRowLayout } from '../../lib/editor/two-row-layout';
import {configureSmoothZoomPatch,rememberZoomTargets,type ZoomTargetEvidence} from '../../lib/ai/zoom-targets';
import {configureCameraMotionPatch} from '../../lib/ai/camera-targets';
import {textGradientPatch} from '../../lib/editor/text-gradient';
import {animateObjects} from '../../lib/ai/object-motion';
import {EFFECT_KEYFRAME_CONTROLS,effectKeyframesPatch} from '../../lib/editor/effect-keyframes';
import {MOTION_EASINGS} from '../../lib/editor/motion-path';
import {SPEED_RAMP_PRESET_IDS,presetAnchors,type SpeedRampPreset} from '../../lib/editor/speed-ramp';
import {MASK_SHAPES} from '../../lib/editor/masks';
import {attachMaskPatch,attachOverlayPatch,bakeMaskAnchors,pointsToSamples} from '../../lib/editor/tracking-attach';
import {CAMERA_ZOOM_RANGE,SMOOTH_ZOOM_EASINGS} from '../../lib/editor/smooth-zoom-settings';
import { modelTimeline, modelAssetAnalysis, modelAssetAnalysisWindows } from "../../lib/ai/editor-context";
import { closeFootageGaps } from "../../lib/editor/close-gaps";
import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc,Id } from "../_generated/dataModel";
import type { Timeline } from "../../lib/editor/types";
import { alignCutsToBeats } from "../../lib/editor/beat-cuts";
import { addBeatMarkers } from "../../lib/editor/beat-markers";
import { addTimelineMarker,moveTimelineMarker,removeTimelineMarker, removeTimelineMarkers } from "../../lib/editor/timeline-markers";
import { dimensions, deriveTrackCounts, deriveTracks, maxTrackCount, timelineDuration, trackOf } from "../../lib/editor/types";
import {VISUAL_INPUT_UNITS,transformInputPatch,cropInputPatch} from '../../lib/editor/visual-inputs';
import { addMediaClip, addEffectClip, convertSolidColorToVisual, setClipPlaybackRate, setClipSpeedRamp, deleteClip, focusForClip, newLayerOverlaps, patchClip, placeOnFreeLayer, splitClip,trimClip,unlinkClips,setClipBlendMode, addTransitionClip } from "../../lib/editor/operations";
import { IRIS_SHAPES, TRANSITION_DIRECTIONS, TRANSITION_PRESETS, WIPE_DIRECTIONS } from '../../lib/editor/clip-transitions';
import { TimelineGestureRejection } from '../../lib/editor/timeline-edit-errors';
import { summarizeTimeline } from "./inspectTimeline";
import { EditSession } from "./editSession";
import { AssistantRunBudget } from "../../lib/ai/run-budget";
import { BLEND_MODES, ZOOM_LIMITS, isZoomPreset, EFFECT_CATALOG,SOLID_COLOR_LIMITS, OFFERED_TIMED_EFFECT_PRESETS,configureTimedEffectPatch, solidColorPatch } from '../../lib/editor/clip-effects';
import { PUNCH_LIMITS } from '../../lib/editor/motion-effect-settings';
import { EDITOR_SKILL_NAMES, editorSkill } from '../../lib/ai/skills';
import { SCENE_LIMITS } from '../../lib/editor/scene-layers';
import { checkSceneCode } from '../../lib/editor/scene-compile';
import { TEXT_EFFECT_PRESETS, TEXT_ANIMATION_PRESETS,TEXT_ANIMATION_LABELS,textAnimationPatch, textEffectPatch, textTemplatePatch } from '../../lib/editor/text-effects';
import { TEXT_LOOKS,textLookPatch } from '../../lib/editor/text-looks';
import { TEXT_FONTS } from '../../lib/editor/text-fonts';
import { applyCaptionStyle,patchCaptionStyles,patchTextStyles,updateCaptionTiming } from '../../lib/editor/caption-editing';
import { captionClipsFromTranscript, captionsCoverTranscript } from '../../lib/editor/transcript-captions';
import { AUDIO_LIMITS,AUDIO_ROLES,audioSettings,configureAudio } from '../../lib/editor/audio-settings';
import { STOCK_AUDIO_IDS,isStockAudioKey,stockAudio } from '../../lib/editor/stock-audio';
import { soundRecipeInput } from '../../lib/audio/sound-recipe';
import { renderSound, encodeWav, soundWaveform } from '../../lib/audio/render-sound';
import { SR } from '../../lib/audio/dsp';
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
import { retainSourceRanges, type RetainedRangeSummary } from '../../lib/editor/retained-ranges';
import { currentSpeechCleanup, keptRanges, snapToSpeech } from '../../lib/speech-cleanup';
import { applySplitEdit, MAX_SPLIT_EDIT_SECONDS } from '../../lib/editor/split-edits';
import type { CleanupCut } from '../../lib/speech-cleanup/types';
import { AUDIO_ACTIVITY_VERSION, AUDIO_QUIET_EDGE_PAD, refineAudioRangeEdges, refineTranscriptWithAudioActivity } from '../../lib/media-analysis/audio-activity';
import { REMOTION_TEXT_PRESETS } from '../../lib/editor/remotion-text';
import { resolvedTextAppearance, TEXT_APPEARANCE_LIMITS, TEXT_TYPOGRAPHY_LIMITS } from '../../lib/editor/text-style';
import { BEAT_ANALYSIS_ENGINE } from '../../lib/media-analysis/beat-map';
import type { ActionCtx } from "../_generated/server";

export class AnalysisStepError extends Error {}
export async function reportAnalysisFailure<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) { if (error instanceof AnalysisStepError) return { success: false as const, error: error.message.slice(0, 1000) }; throw error; }
}

export type EditorRun = { projectId: Id<'projects'>; ownerId: string; runId: string };
export type EditorToolkitOptions = {
  run: EditorRun;
  project: Doc<'projects'>;
  /** Shared with the caller; analysis and generated sounds update it in place. */
  assets: Doc<'assets'>[];
  /** A recovering run must inspect the timeline before its first edit. */
  recovering: boolean;
  initialPlans: EffectPlan[];
  selectedClipIds: string[];
  playhead?: number;
  /** The chat turn a destructive replacement is published to, when there is one. */
  publication?: { threadId: string; promptMessageId: string };
  abortSignal: AbortSignal;
  budget: AssistantRunBudget;
  /** MCP clients review their own work (getFrames); effects need no in-turn plan there. */
  planlessEffects?: boolean;
};

/** The editor's AI tools bound to one active run: the in-app assistant and MCP share them. */
export function createEditorToolkit(ctx: ActionCtx, options: EditorToolkitOptions) {
  const { run, project, assets, recovering, selectedClipIds, abortSignal, budget } = options;
  let inspected = false;
  let effectPlans:EffectPlan[]=options.initialPlans;
  // Once this environment reports no review service, later reviews answer at once.
  let reviewServiceMissing=false;
  const reviewUnavailableResult={reviewed:false,reviewUnavailable:true,note:'Visual review is not available in this environment. Say the result was not visually checked; do not retry.'};
  const sceneCheckNote='Scenes are checked by their code, never planned or reviewed as effects. Walk through the scene\'s key times in its code instead.';
  const visualEvidence=new Map<string,EffectEvidence>();
  const zoomTargets=new Map<string,ZoomTargetEvidence>();
  const planBindings=new Map<string,string>();
  let editingStarted: Promise<null> | undefined;
  const beginEditing = () => editingStarted ??= ctx.runMutation(internal.assistant.beginEditing, run);
  const editSession = new EditSession(project.timeline ?? { clips: [], fps: 30, aspectRatio: project.aspectRatio }, project.revision ?? 0, {
    apply: (timeline, expectedRevision,publication) => ctx.runMutation(internal.assistant.apply, { ...run, timeline, expectedRevision,...(publication&&options.publication?{publication:options.publication}:{}) }),
    validate: (timeline, expectedRevision) => ctx.runMutation(internal.assistant.previewDraft, { ...run, timeline, expectedRevision }),
    refresh: async () => { return await ctx.runQuery(internal.assistant.getRunTimeline,run); },
    beforeChange: beginEditing,
  }, abortSignal);
  const checkpoint = (edit: (timeline: Timeline) => Timeline) => editSession.checkpoint(timeline => { if (recovering && !inspected) throw new Error('Inspect the current timeline before continuing the saved edit.');
    const next = edit(timeline), collision = newLayerOverlaps(timeline, next)[0];
    // Refuse before the draft changes; the server repeats this check on every assistant write.
    if (collision) throw new TimelineGestureRejection(`Clips ${collision[0].id} and ${collision[1].id} would overlap on the same layer. Move one to another time or layer first.`, 'overlap');
    return next; });
  const markerCheckpoint = async (edit: (timeline: Timeline) => Timeline) => {
    const result = await checkpoint(edit);
    return { ...result, removed: result.removedMarkerIds.length };
  };
  const find = (timeline: Timeline, id: string) => { const clip = timeline.clips.find(c => c.id === id); if (!clip) throw new Error("Clip not found"); return clip; };
  const textColor = z.string().regex(/^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i);
  const appearanceColor=z.string().regex(/^#[\da-f]{6}$/i);
  const textStyleInput=z.object({strokeWidth:z.number().min(TEXT_APPEARANCE_LIMITS.strokeWidth[0]).max(TEXT_APPEARANCE_LIMITS.strokeWidth[1]).optional(),strokeColor:appearanceColor.optional(),shadowBlur:z.number().min(TEXT_APPEARANCE_LIMITS.shadowBlur[0]).max(TEXT_APPEARANCE_LIMITS.shadowBlur[1]).optional(),shadowX:z.number().min(TEXT_APPEARANCE_LIMITS.shadowX[0]).max(TEXT_APPEARANCE_LIMITS.shadowX[1]).optional(),shadowY:z.number().min(TEXT_APPEARANCE_LIMITS.shadowY[0]).max(TEXT_APPEARANCE_LIMITS.shadowY[1]).optional(),shadowColor:appearanceColor.optional(),glowBlur:z.number().min(TEXT_APPEARANCE_LIMITS.glowBlur[0]).max(TEXT_APPEARANCE_LIMITS.glowBlur[1]).optional(),glowColor:appearanceColor.optional(),fontWeight:z.number().int().min(TEXT_TYPOGRAPHY_LIMITS.fontWeight[0]).max(TEXT_TYPOGRAPHY_LIMITS.fontWeight[1]).optional(),italic:z.boolean().optional(),letterSpacing:z.number().min(TEXT_TYPOGRAPHY_LIMITS.letterSpacing[0]).max(TEXT_TYPOGRAPHY_LIMITS.letterSpacing[1]).optional(),lineHeight:z.number().min(TEXT_TYPOGRAPHY_LIMITS.lineHeight[0]).max(TEXT_TYPOGRAPHY_LIMITS.lineHeight[1]).optional(),textAlign:z.enum(['left','center','right']).optional(),paddingX:z.number().min(0).max(200).optional(),paddingY:z.number().min(0).max(200).optional(),borderRadius:z.number().min(0).max(200).optional()});
  const fontFamily=z.enum(TEXT_FONTS.map(font=>font.id));
  const clipIdsInput=z.array(z.string().min(1).max(100)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'});
  // A named easing, or a cubic-bézier [x1,y1,x2,y2] (y may overshoot for anticipation/bounce).
  const motionEasingInput=z.union([z.enum(MOTION_EASINGS),z.tuple([z.number().min(0).max(1),z.number().min(-1).max(2),z.number().min(0).max(1),z.number().min(-1).max(2)])]);
  const objectMotionInput=z.object({clipId:z.string().min(1),replaceMotion:z.boolean().optional(),keyframes:z.array(z.object({time:z.number().min(0),x:z.number().min(-1).max(1),y:z.number().min(-1).max(1),scale:z.number().min(.1).max(5),rotation:z.number().min(-360).max(360),opacity:z.number().min(0).max(1),brightness:z.number().min(0).max(4),easing:motionEasingInput.optional()}).strict()).max(120)}).strict();
  const pulseInputs={
    punch:z.object({amount:z.number().min(PUNCH_LIMITS.amount[0]).max(PUNCH_LIMITS.amount[1]).optional(),speed:z.number().min(PUNCH_LIMITS.speed[0]).max(PUNCH_LIMITS.speed[1]).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional(),attack:z.number().min(PUNCH_LIMITS.attack[0]).max(PUNCH_LIMITS.attack[1]).optional(),release:z.number().min(PUNCH_LIMITS.release[0]).max(PUNCH_LIMITS.release[1]).optional()}).strict().optional(),
  };
  const zoomInput=z.object({direction:z.enum(['in','out']).optional(),amount:z.number().min(ZOOM_LIMITS.amount[0]).max(ZOOM_LIMITS.amount[1]).optional(),speed:z.number().min(ZOOM_LIMITS.speed[0]).max(ZOOM_LIMITS.speed[1]).optional(),centerX:z.number().min(0).max(1).optional(),centerY:z.number().min(0).max(1).optional()});
  const solidColorInput=z.object({color:z.string().regex(/^#[\da-f]{6}$/i).optional(),width:z.number().min(SOLID_COLOR_LIMITS.width[0]).max(SOLID_COLOR_LIMITS.width[1]).optional(),height:z.number().min(SOLID_COLOR_LIMITS.height[0]).max(SOLID_COLOR_LIMITS.height[1]).optional(),x:z.number().min(0).max(1).optional(),y:z.number().min(0).max(1).optional(),opacity:z.number().min(0).max(1).optional()});
  const textInput = z.object({ text: z.string().min(1).max(2000), track: z.number().int().min(1).max(24).optional(), start: z.number().min(0), duration: z.number().positive(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), animation: z.enum(["none", "fade", "rise"]).optional(),textStyle:textStyleInput.optional() });
  const withAnalysis = async <T,>(assetId: string, mode: "transcribe" | "understand" | "shots" | "beats" | "track" | "video" | "frames", read: (request: Doc<"analysisRequests">) => Promise<T>, inspection?: { videoRequest?: VideoInspectionInput; frameRequest?: FrameInspectionInput }) => {
    budget.pauseForAnalysis();
    try {
    const requestId = await ctx.runMutation(internal.assistant.requestAnalysis, { ...run, assetId, mode, ...inspection });
    try {
      while (true) {
        abortSignal.throwIfAborted();
        const request = await ctx.runQuery(internal.assistant.analysisRequest, { ...run, requestId });
        if (request.status === "failed") throw new AnalysisStepError(request.error ?? "Media analysis could not complete");
        if (request.status === "completed") return await read(request);
        if (request.expiresAt <= Date.now()) throw new AnalysisStepError("Media analysis is taking longer than this edit request allows. Its background job will save results; try the edit again once processing finishes.");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally { await ctx.runMutation(internal.assistant.clearAnalysis, { ...run, requestId }); }
    } finally { budget.resumeAfterAnalysis(); }
  };
  const loadAsset=async(assetId:string)=>{const asset=await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId});const index=assets.findIndex(item=>item._id===asset._id);if(index<0)throw new Error('Choose media from this project');assets[index]=asset;return asset;};
  const savedCheckpoint=async(assetId:string,edit:(timeline:Timeline)=>Timeline)=>{await loadAsset(assetId);return checkpoint(edit);};
  // Processed copies (freeze stills, smooth slow motion, upscales) come from the media worker.
  type DeriveInput={clipId:string;assetId:string;op:'freeze'|'slowmo'|'upscale'|'stats';start:number;end:number;time?:number;times?:number[];factor?:number;target?:number;fps?:number;placeLater:boolean};
  const derive=(input:DeriveInput)=>ctx.runMutation(internal.derivations.startFromRun,{...run,...input});
  const adoptAsset=async(assetId:string)=>{const asset=await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId});const index=assets.findIndex(item=>item._id===asset._id);if(index<0)assets.push(asset);else assets[index]=asset;return asset;};
  // Color measured on the worker from a clip's source frames at timeline moments (default: three across the clip).
  const measureClip=async(clip:Timeline['clips'][number],times?:number[]):Promise<ColorStats[]>=>{
    if((clip.kind!=='video'&&clip.kind!=='image')||!clip.assetId)throw new Error('Measure color on a video or image clip.');
    const end=clip.start+clip.duration-1/editSession.timeline.fps,moments=(times?.length?times:[.15,.5,.85].map(fraction=>clip.start+clip.duration*fraction)).map(time=>Math.min(end,Math.max(clip.start,time)));
    const sourceTimes=clip.kind==='image'?[0]:moments.map(time=>sourceTimeAt(clip,time));
    const started=await derive({clipId:clip.id,assetId:clip.assetId,op:'stats',start:sourceTimes[0],end:sourceTimes[sourceTimes.length-1],times:sourceTimes,placeLater:false});
    budget.pauseForAnalysis();
    try{
      const deadline=Date.now()+90_000;
      while(true){
        abortSignal.throwIfAborted();
        const row=await ctx.runQuery(internal.derivations.runStatus,{...run,derivationId:started.derivationId});
        if(row.status==='failed')throw new AnalysisStepError(row.error??'Color measurement failed.');
        if(row.status==='completed'&&row.stats)return row.stats as ColorStats[];
        if(Date.now()>deadline)throw new AnalysisStepError('Color measurement is taking too long. Try again in a minute.');
        await new Promise(resolve=>setTimeout(resolve,700));
      }
    }finally{budget.resumeAfterAnalysis();}
  };
  const curveInput=z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(2).max(16);
  const awaitDerivation=async(derivationId:Id<'derivations'>,limitMs:number)=>{
    budget.pauseForAnalysis();
    try{
      const deadline=Date.now()+limitMs;
      while(true){
        abortSignal.throwIfAborted();
        const row=await ctx.runQuery(internal.derivations.runStatus,{...run,derivationId});
        if(row.status==='failed')throw new AnalysisStepError(row.error??'Media processing failed.');
        if(row.status==='completed'&&row.outputAssetId)return adoptAsset(row.outputAssetId);
        if(Date.now()>deadline)throw new AnalysisStepError('Media processing is taking longer than this edit allows. Try again in a minute.');
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }finally{budget.resumeAfterAnalysis();}
  };
  // A media task links to one analysis request. Parallel tool calls for the
  // same source and mode share one request: a second request would relink the
  // task and leave the first waiting until it timed out.
  const sharedAnalyses = new Map<string, ReturnType<typeof analyzeOnce>>();
  const transcriptRefreshFailures = new Map<string, string>();
  const analyze = async (assetId: string, mode: "transcribe" | "understand" | "shots" | "beats" | "track", requireAudioActivity = false) => {
    const key = `${assetId}:${mode}`;
    const shared = sharedAnalyses.get(key);
    if (shared) {
      const asset = await shared;
      // The shared call may not have needed boundary audio; measure it afterwards.
      return requireAudioActivity && asset.analysis?.audioActivity?.version !== AUDIO_ACTIVITY_VERSION ? analyzeOnce(assetId, mode, true) : asset;
    }
    const pending = analyzeOnce(assetId, mode, requireAudioActivity).finally(() => sharedAnalyses.delete(key));
    sharedAnalyses.set(key, pending);
    return pending;
  };
  const analyzeOnce = async (assetId: string, mode: "transcribe" | "understand" | "shots" | "beats" | "track", requireAudioActivity = false, remeasure = false) => {
    if (!remeasure && (mode === 'understand' || mode === 'transcribe')) {
      const saved = await loadAsset(assetId);
      if (mode === 'understand' ? saved.analysis?.understanding : currentTranscript(saved.analysis?.transcript) && (!requireAudioActivity || saved.analysis?.audioActivity?.version === AUDIO_ACTIVITY_VERSION)) return saved;
    }
    const request = () => withAnalysis(assetId, mode, async () => {
      const next=await ctx.runQuery(internal.assistant.getRunAsset,{...run,assetId});
      if (!next?.analysis) throw new Error("Media analysis completed without saved results");
      if (mode === 'beats' && next.analysis.beats?.engine !== BEAT_ANALYSIS_ENGINE) throw new Error("Dedicated beat tracking did not return a current beat map. Analyze this audio source again.");
      const index = assets.findIndex(asset => asset._id === next._id); assets[index] = next;
      return next;
    });
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
    const chosen = chosenRanges.map(range => ({ start: Math.max(clip.sourceStart, range.start), end: Math.min(sourceEnd, range.end) })).filter(range => range.end > range.start);
    if (!chosen.length) throw new Error('None of the ranges is inside this clip’s retained source.');
    const inside = (cut: { start: number; end: number }) => chosen.some(range => cut.end > range.start && cut.start < range.end);
    // Cuts in this clip's source time, only where the kept ranges are.
    const cuts: CleanupCut[] = cleanup.cuts.filter(cut => kinds.has(cut.kind) && cut.confidence >= minConfidence).map(cut => ({ ...cut, start: cut.start - offset, end: cut.end - offset })).filter(inside);
    const transcript = evidence.analysis!.transcript!, activity = evidence.analysis!.audioActivity;
    const ranges = chosen.flatMap(range => keptRanges(range.start, range.end, cuts)).map(range => {
      const source = { start: range.start + offset, end: range.end + offset };
      const measured = cleanup.edges?.length === transcript.words.length * 2 ? snapToSpeech(source, transcript.words, cleanup.edges) : activity ? refineAudioRangeEdges(source, transcript, activity) : source;
      return { start: Math.max(range.start, measured.start - offset), end: Math.min(range.end, measured.end - offset) };
    }).filter(range => (range.end - range.start) / playbackRateOf(clip) >= 1 / editSession.timeline.fps);
    const chosenLength = chosen.reduce((total, range) => total + range.end - range.start, 0), keptLength = ranges.reduce((total, range) => total + range.end - range.start, 0);
    const count = (kind: string) => cuts.filter(cut => cut.kind === kind).length;
    // What the user is told: the edit removed these, on top of the ranges that were chosen.
    const speechCleanup = { pauses: count('pause'), breaths: count('breath'), fillers: count('filler'), retakes: count('restart'), removedSeconds: Math.round(Math.max(0, chosenLength - keptLength) * 100) / 100, keptPieces: ranges.length, edges: 'measured word sound, millisecond-exact' };
    if (preview) return { preview: true, speechCleanup, cuts: cuts.slice(0, 200).map(cut => ({ kind: cut.kind, start: cut.start, end: cut.end, confidence: cut.confidence, detail: cut.detail })), keptRanges: ranges };
    if (!ranges.length) throw new Error('Cleanup would remove everything chosen; raise minConfidence or limit kinds.');
    if (ranges.length > 100) throw new Error(`Cleanup would split this clip into ${ranges.length} pieces; clean a shorter clip, raise minConfidence or limit kinds.`);
    let retainedRanges: RetainedRangeSummary[] = [];
    // Speech edges are measured to the millisecond; rounding them to frames would add back up to 33 ms of air per edge.
    const result = await checkpoint(t => { const retained = retainSourceRanges(t, clipId, ranges, undefined, true); retainedRanges = retained.ranges; return retained.timeline; });
    return { ...result, speechCleanup, retainedRanges };
  };
  const transformFields={units:z.enum(VISUAL_INPUT_UNITS).optional(),x:z.number().optional(),y:z.number().optional(),scale:z.number().min(.1).max(5).optional(),rotation:z.number().min(-360).max(360).optional(),opacity:z.number().min(0).max(1).optional()};
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
  // Render, upload to the project's R2 media like an upload, and register an ordinary audio asset holding its recipe.
  const createGeneratedSound = async (input: unknown, name?: string) => {
    const { recipe, samples } = renderSound(input), key = `media/${run.ownerId}/${run.projectId}/${crypto.randomUUID()}`;
    const size = await putMediaObject(key, encodeWav(samples), 'audio/wav');
    try {
      const asset = await ctx.runMutation(internal.assistant.saveGeneratedSound, { ...run, r2Key: key, fileName: `${(name ?? 'Generated sound').replace(/[\\/:*?"<>|]/g, '')}.wav`, size, duration: samples[0].length / SR, waveform: soundWaveform(samples), recipe: JSON.stringify(recipe) });
      assets.push(asset);
      return asset;
    } catch (error) { await storageControl({ action: 'delete', key }).catch(() => {}); throw error; }
  };
  const trimChangeInput=z.object({clipId:z.string().min(1),duration:z.number().positive(),sourceStart:z.number().min(0).optional()});
  const tools = {
    planEffects:createTool({description:"Not for scene clips: scenes are verified by their code, never planned or reviewed as effects. Not for simple edits whose result is known from their settings: fades, crossfades or dissolves built from existing footage, opacity, volume, cuts, trims, moves, crops, layout and split screens. Apply those directly; never plan or previewRender them. Before an authorized effect or creative styling edit whose look must be judged (zoom punches, footage or texture effects, text looks), record one to eight concrete expectations: purpose, actual supported strength, timeline window/peak and anchor. Derive acceptance criteria from the current user request and decoded evidence; do not add new creative requirements. Subject readability means the requested object remains recognizable, not that fine print becomes legible unless the user explicitly asks for that. Describe the observed action literally: a hand-held object moving through the air is not evidence of unsupported free flight. If the requested opening is ambiguous, inspect it before claiming a hover or release. For observed action, use an evidenceId returned by this run's inspectVideo mapped match; never invent an impact. Markers and cuts must still exist. Requested-time anchors are for explicit requested timing. Include targetClipId for existing footage/text. No timeline edits, no approval question. Long looks can be reviewed in a short sample window. Calls add or update plans by ID and retain other plans and their output links, up to eight per run. Use a separate timed plan for each FX pulse with its actual start and full duration. Reviewed expectations stay fixed; other plans can still be corrected. To attach an output for review, pass previewRender bindings instead of rewriting the plan.",inputSchema:z.object({plans:z.array(effectPlanInput).min(1).max(8)}),execute:async(_ctx,{plans})=>{
      // Selecting an edit plan is explicit workflow intent, even while the
      // model corrects a rejected preflight before its first timeline write.
      await beginEditing();
      await editSession.wait();
      const sceneIds=new Set(editSession.timeline.clips.filter(clip=>clip.kind==='scene').map(clip=>clip.id));
      if(plans.some(plan=>[plan.targetClipId,plan.outputClipId,plan.anchor.kind==='cut'?plan.anchor.clipId:undefined].some(id=>id&&sceneIds.has(id))))return {planned:false,sceneTarget:true,note:sceneCheckNote,plans:effectPlans};
      validateEffectPlan(plans,editSession.timeline,visualEvidence);
      const merged=mergeEffectPlans(effectPlans,plans);
      const originals=editSession.timeline.clips.filter(clip=>merged.some(plan=>(plan.outputClipId??plan.targetClipId)===clip.id));
      await ctx.runMutation(internal.compositionReview.savePlan,{...run,plans,originals});
      for(const plan of plans)if(!equalTimelineValue(effectPlans.find(previous=>previous.id===plan.id),plan))planBindings.delete(plan.id);
      effectPlans=merged;return {planned:true,plans:effectPlans,revision:editSession.revision,saved:false,staged:editSession.staged};
    }}),
    previewRender:createTool({description:"Not for scene clips. Review one or two planned effects using the actual composited timeline, the export frame-capture engine and an effect-disabled reference. Returns measured pixel differences, clip timing/text bounds and narrow Gemini observations about the recorded expectations, with uncertainty. Each selected expectation, including start/anchor/peak/return, must fit inside the same three-second sampled window. If two expectations span more than three seconds, review each planId separately; do not repeatedly submit the same out-of-window pair. After a failed check make one targeted correction; two nonpassing judgments stop that expectation. Reuse passed checks unless another edit changes their visible scope, then refresh only those affected. A rejected window or failed renderer is not a completed visual judgment. Finish planned edits before reviewing. Optional bindings attach each selected plan to its existing output clip without changing the plan or repeating a passed review. Each timed plan must describe exactly one matching FX clip and its full range; separate pulses need separate plans. Does not edit the timeline. Sparse stills cannot prove audio sync, continuous motion, exact between-sample contact, or the whole edit's taste. After a failed check, correct only that expectation and review the corrected result once. Do not repeat passed checks or loop on an unavailable service. If the final review still fails, name the unfinished expectation in the final reply and do not claim full completion.",inputSchema:z.object({planIds:z.array(z.string()).min(1).max(2),bindings:z.array(z.object({planId:z.string(),clipId:z.string()})).max(2).optional()}),execute:async(_ctx,{planIds,bindings:explicitBindings})=>reportAnalysisFailure(async()=>{
      await editSession.wait();
      if(reviewServiceMissing)return reviewUnavailableResult;
      // Without a recorded plan there is nothing to review; that is guidance, not a failed step.
      const selected=planIds.map(id=>effectPlans.find(plan=>plan.id===id));if(selected.some(plan=>!plan))return {reviewed:false,needsPlan:true,note:`Nothing is planned under that ID, so there is nothing to review. ${sceneCheckNote} For an effect edit, record it with planEffects first.`};
      if(explicitBindings&&(new Set(explicitBindings.map(binding=>binding.planId)).size!==explicitBindings.length||explicitBindings.some(binding=>!planIds.includes(binding.planId))))throw new Error('Bind each selected review plan at most once.');
      const known=planIds.flatMap(planId=>{const clipId=explicitBindings?.find(binding=>binding.planId===planId)?.clipId??planBindings.get(planId);return clipId?[{planId,clipId}]:[];});
      const bindings=effectReviewBindings(selected as EffectPlan[],editSession.timeline,known);
      budget.pauseForAnalysis();
      let reviewId:Id<'compositionReviews'>|undefined;
      try{
        reviewId=await ctx.runMutation(internal.compositionReview.request,{...run,expectedRevision:editSession.revision,timeline:editSession.timeline,planIds,bindings});
        const deadline=Date.now()+180000;
        while(true){abortSignal.throwIfAborted();const review=await ctx.runQuery(internal.compositionReview.get,{...run,reviewId});
          // An environment without the review service cannot review; report it plainly instead of failing.
          if(review.status==='failed'&&/composition review is not configured/i.test(review.error??'')){reviewServiceMissing=true;return reviewUnavailableResult;}
          if(review.status==='failed')throw new AnalysisStepError(review.error??'Rendered review failed.');
          if(review.status==='completed'){const current=await ctx.runQuery(internal.assistant.getRunTimeline,run),stale=current.revision!==review.result?.revision;return {reviewed:!stale,stale,currentRevision:current.revision,scope:stale?'The timeline changed during review. Inspect the latest state; this receipt describes the earlier snapshot.':'Sampled composited timeline; no audio judgment',staged:editSession.staged,...review.result};}
          if(Date.now()>deadline)throw new AnalysisStepError('Rendered review exceeded its three-minute limit. Saved edits remain.');
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      }finally{try{if(reviewId)await ctx.runMutation(internal.compositionReview.cancel,{...run,reviewId});}finally{budget.resumeAfterAnalysis();}}
    })}),
    duplicateClips:createTool({description:"Copy explicitly identified existing clips to requested timeline seconds, or duplicate immediately after the latest selected end when at is omitted. Preserve source ranges, relative timing, appearance, audio settings and linked pairs. Copy both neighboring sources together with a selected transition to remap its pair correctly. Uses the same free-layer placement as the editor; never reads the browser clipboard or invents media.",inputSchema:z.object({clipIds:clipIdsInput,at:z.number().min(0).optional()}),execute:async(_ctx,{clipIds,at})=>{
      let newClipIds:string[]=[];
      const saved=await checkpoint(t=>{for(const id of clipIds)find(t,id);const copies=copyTimelineClips(t,clipIds);const result=pasteTimelineClips(t,copies,at??Math.max(...copies.map(c=>c.start+c.duration)));newClipIds=result.ids;return result.timeline});
      return {...saved,newClipIds};
    }}),
    reorderLayer:createTool({description:"Move a whole occupied or empty layer within its own V/visual, A/audio or FX/effects group, preserving all clip timing and shifting intervening layer numbers as in the editor. from/to are layer numbers, not clip IDs. Audio never becomes visual/FX; source media and linked timing remain.",inputSchema:z.object({group:z.enum(['visual','audio','effects']),from:z.number().int().min(1).max(24),to:z.number().int().min(1).max(24)}),execute:async(_ctx,{group,from,to})=>checkpoint(t=>reorderLayer(t,group,from,to))}),
    moveClips:createTool({description:"Move an explicitly selected clip group by signed timeline timeDelta and/or layerDelta while retaining relative timing and reciprocal linked audio. Same free-layer collision/boundary behavior as a manual group drag. Preserve all source ranges and other clip controls; zero layerDelta preserves the group's layer positions.",inputSchema:z.object({clipIds:clipIdsInput,timeDelta:z.number().optional(),layerDelta:z.number().int().min(-24).max(24).optional()}).refine(input=>input.timeDelta!==undefined||input.layerDelta!==undefined,{message:'Specify a time or layer delta.'}),execute:async(_ctx,{clipIds,timeDelta,layerDelta})=>checkpoint(t=>{for(const id of clipIds)find(t,id);return moveSelectedClips(t,clipIds,timeDelta??0,layerDelta??0)})}),
    resizeClips:createTool({description:"Trim or extend one requested edge of an explicitly selected group by signed timeline delta seconds, snapped to project frames. Use side left or right; retain animation/audio phase and linked timing. Clamp at source bounds, neighboring clips and one-frame minimum exactly as the editor's edge drag; never invent source handles. Read actual resulting ranges from the saved result.",inputSchema:z.object({clipIds:clipIdsInput,side:z.enum(['left','right']),delta:z.number()}),execute:async(_ctx,{clipIds,side,delta})=>checkpoint(t=>{for(const id of clipIds)find(t,id);return resizeSelectedClips(t,assets.map(asset=>({...asset,url:null})),clipIds,side,delta)})}),
    setBlendMode:createTool({description:"Set the requested supported blend mode on exact footage/text clip IDs, preserving all other controls. Apply both sides of an existing transition atomically when changing their common blend; unequal transition blends are refused. Audio and FX clips cannot receive blend modes.",inputSchema:z.object({clipIds:clipIdsInput,blendMode:z.enum(BLEND_MODES)}),execute:async(_ctx,{clipIds,blendMode})=>checkpoint(t=>setClipBlendMode(t,clipIds,blendMode))}),
    undoLatestEdit:createTool({description:"Undo the latest actually saved edit first, only before this turn has applied or staged any changes. Uses saved history, never a guessed replacement/source extension. Returns undone:false when there is no saved edit. Refreshes the working timeline; subsequent changes can be saved together as a new undo group. Inspect the restored clips before choosing targets.",inputSchema:z.object({}),execute:async()=>{
      if (recovering && !inspected) throw new Error('Inspect the current timeline before continuing the saved edit.');
      let undone=false;
      const snapshot=await editSession.inspect(async()=>{
        if(editSession.savedEdits||editSession.staged)throw new Error('Undo the latest saved edit before making changes in this turn.');
        const result=await ctx.runMutation(internal.assistant.undoLatestEdit,{...run,expectedRevision:editSession.revision});undone=result.undone;return result;
      });
      return {...snapshot,undone,saved:undone,applied:undone,message:undone?'Latest saved edit undone.':'No saved edits to undo.',summary:summarizeTimeline(snapshot.timeline,assets)};
    }}),
    unlink:createTool({description:"Unlink an identified video/audio pair while keeping both clips, media, source ranges, timing, volume and settings. After unlink, deleting/trimming/splitting only the video leaves its original audio independent. Select either pair member; preserve other clips. Does not enable the muted separated video's duplicate sound.",inputSchema:z.object({clipId:z.string().min(1).max(100)}),execute:async(_ctx,{clipId})=>{
      let clipIds:string[]=[];
      const result=await checkpoint(t=>{
        const clip=find(t,clipId);if(clip.kind!=='video'&&clip.kind!=='audio')throw new Error('Choose a video or audio clip to unlink.');
        if(!clip.linkedClipId)return t;
        const pair=find(t,clip.linkedClipId);if(pair.linkedClipId!==clip.id)throw new Error('Choose a reciprocal linked video/audio pair.');
        clipIds=[clip.id,pair.id];return unlinkClips(t,clipId);
      });
      return {...result,unlinked:clipIds.length>0,clipIds};
    }}),
    inspectTimeline: createTool({ description: "Read this active project's current working timeline (the open timeline tab, named in openTimeline) and saved revision. If staged is true, this is a private replacement draft that has not been published yet. Expose each labeled layer with its group and number: FX effects-only, V video/image/text/solid-color, A audio. Timeline clips include their kind and track. Report visual coverage gaps, overlaps within the same group/layer, missing media references and effective text animation labels. Higher stacked layers are intentional and are not overlap errors. This tool does not change the timeline or create an undo entry.", inputSchema: z.object({}), execute: async () => {
      const snapshot = await editSession.inspect(async () => {
        const current = await ctx.runQuery(internal.assistant.getRun, run);
        assets.splice(0,assets.length,...current.assets.map(asset=>{const previous=assets.find(item=>item._id===asset._id);return previous?.analysis&&previous.analysisId===asset.analysisId&&previous.analysisUpdatedAt===asset.analysisUpdatedAt?{...asset,analysis:previous.analysis}:asset;}));
        return { timeline: current.project.timeline ?? { clips: [], fps: 30, aspectRatio: current.project.aspectRatio }, revision: current.project.revision ?? 0 };
      });
      inspected = true;
      const captionedAssetIds=assets.filter(asset=>{
        const raw=asset.analysis?.transcript;
        if(!raw)return false;
        const transcript=asset.analysis?.audioActivity?refineTranscriptWithAudioActivity(raw,asset.analysis.audioActivity):raw;
        return captionsCoverTranscript(snapshot.timeline,asset._id,transcript);
      }).map(asset=>asset._id);
      // Tabs cannot change during a run, so the run's project names the open one.
      const tabs = project.timelineTabs?.length ? project.timelineTabs : [{ id: 'main', name: 'Timeline 1' }], openTab = tabs.find(tab => tab.id === (project.activeTimelineId ?? tabs[0].id)) ?? tabs[0];
      return { ...snapshot, openTimeline: { timelineId: openTab.id, name: openTab.name, otherTimelines: tabs.filter(tab => tab !== openTab).map(tab => tab.name) }, captionedAssetIds, timeline: modelTimeline(snapshot.timeline, selectedClipIds), layers: deriveTracks(snapshot.timeline), summary: summarizeTimeline(snapshot.timeline, assets) };
    } }),
    inspectClip: createTool({ description: "Read one exact current clip including all motion/focus samples and settings omitted from the compact timeline. Uses the working edit session; no edits. Read inspectTimeline first when fresh saved state is needed.", inputSchema: z.object({ clipId: z.string() }), execute: async (_ctx, input) => { await editSession.wait(); const clip = find(editSession.timeline, input.clipId), soundRecipe = assets.find(item => item._id === clip.assetId)?.soundRecipe; return { clip, ...(soundRecipe ? { soundRecipe: JSON.parse(soundRecipe) } : {}), revision: editSession.revision, staged: editSession.staged }; } }),
    analyzeMedia: createTool({ description: "Request real analysis of this project's uploaded media through durable background jobs. Transcribe word-timed speech, create a native Gemini video overview, measure music beats, or track a visible face. mode track uses face detection only; for a can or other object use inspectFrames and configureCameraMotion mode follow. Use inspectVideo with the actual user question to find specific visual moments; a generic overview is not an answer to every editing question. Saved results are usable immediately; never invent unavailable results.", inputSchema: z.object({ assetId: z.string(), mode: z.enum(["transcribe", "understand", "beats", "track"]) }), execute: async (_ctx, input) => {
      return reportAnalysisFailure(async () => {
      const asset = await analyze(input.assetId, input.mode);
      return { analyzed: true, assetId: asset._id, mode: input.mode, ...(input.mode === "transcribe" ? { segmentCount: asset.analysis?.transcript?.segments.length, wordCount: asset.analysis?.transcript?.words.length } : {}), ...(input.mode === "understand" ? { summary: asset.analysis?.understanding?.summary, sceneCount: asset.analysis?.understanding?.scenes.length } : {}), ...(input.mode === "beats" ? { bpm: asset.analysis?.beats?.bpm, beatCount: asset.analysis?.beats?.beats.length, downbeatCount: asset.analysis?.beats?.downbeats?.length ?? 0, accentCount: asset.analysis?.beats?.accents?.length ?? 0, dropCandidateCount: asset.analysis?.beats?.dropCandidates?.length ?? 0, engine: asset.analysis?.beats?.engine, confidence: asset.analysis?.beats?.confidence } : {}), ...(input.mode === "track" ? { sampleCount: asset.analysis?.focus?.length } : {}) };
      });
    } }),
    inspectVideo: createTool({ description: "Ask Gemini to dynamically inspect this uploaded native video for the user's actual visual question, such as finding fights, a reaction, a punch or an object. Never use it for trims, cuts, take selection or removing repeats and pauses unless the user explicitly asked for a visual check (watching the footage, eyes-to-camera, awkward look-ups). Optional start/end are SOURCE seconds and default to the whole source; only that window is uploaded, so ask about a window of up to about 60 seconds around the candidate moments (one question per line or take). Whole-source questions on long footage are slow and can outlast this edit. Use the transcript, not this tool, to find which words were said and where. Returns relevant source-time windows, an answer, honest uncertainty, and matches mapped onto retained timeline clips. Zero matches is valid. No timeline changes. Times are approximate visual evidence, never invented frame indices or sample counts.", inputSchema: z.object({ assetId: z.string(), question: z.string().min(1).max(MAX_INSPECTION_QUESTION), start: z.number().min(0).optional(), end: z.number().positive().optional() }), execute: async (_ctx, input) => {
      const asset = assets.find(item => item._id === input.assetId);
      if (asset?.kind !== 'video' || !asset.duration) throw new Error('Choose a video source from this project.');
      const videoRequest = { question: input.question.trim(), start: input.start ?? 0, end: input.end ?? asset.duration };
      validateVideoInspectionInput(videoRequest, asset.duration);
      return reportAnalysisFailure(() => withAnalysis(input.assetId, 'video', async request => {
        if (!request.videoInspection) throw new Error('Native video inspection completed without saved evidence.');
        await editSession.wait();
        const evidence = request.videoInspection;
        return { assetId: input.assetId, ...evidence, matchCount: evidence.matches.length, timelineOccurrences: editSession.timeline.clips.filter(clip => clip.kind === 'video' && clip.assetId === input.assetId).map(clip => ({ clipId: clip.id, sourceStart: clip.sourceStart, timelineStart: clip.start, duration: clip.duration, playbackRate: playbackRateOf(clip), matches: videoMatchesOnClip(evidence, clip).map(match=>{const evidenceId=crypto.randomUUID();visualEvidence.set(evidenceId,{clipIds:[clip.id],start:match.timelineStart,end:match.timelineEnd});return {...match,evidenceId};}) })) };
      }, { videoRequest }));
    } }),
    inspectFrames: createTool({ description: "Inspect decoded timestamped images near an audio/transcript candidate or observed visual event for precise visual cleanup, such as checking a script glance. For speech cuts and take selection use it only when the user explicitly asked for a visual check such as eye contact or awkward look-ups. Required start/end are SOURCE seconds, a focused window up to three seconds, with at most twelve actual frames. Use precision consecutive to verify a suspected brief glance or cut boundary: first localize the candidate, then use the returned narrow refinement window with the same focused question. Skipped frames cannot pass this precision check. Never scan every cut automatically. Returns observations, uncertainty, sampling gaps and exact source/timeline positions for retained frames. Sparse images cannot prove continuous motion, speech absence, audio sync or unseen event boundaries. For a named zoom target such as a modal/button/cursor, ask to locate that target: returned targets include source-coordinate boxes and current-request targetIds. Use targetId with configureSmoothZoom or configureCameraMotion; never guess coordinates. For sampled cursor/object following inspect distinct source instants; returned source/timeline times bind each location to an actual decoded frame. Inspect a relevant nearby frame, not every frame or a fixed padding window. No timeline changes; preserve speech using word timings and measured audio before cutting.", inputSchema: z.object({ assetId: z.string(), question: z.string().trim().min(1).max(1000), start: z.number().min(0), end: z.number().positive(), precision: z.enum(['sampled', 'consecutive']).optional() }), execute: async (_ctx, input) => {
      const asset = assets.find(item => item._id === input.assetId);
      if (asset?.kind !== 'video' || !asset.duration) throw new Error('Choose a video source from this project.');
      const frameRequest = { start: input.start, end: input.end, question: input.question.trim() };
      validateFrameInspectionInput(frameRequest, asset.duration);
      return reportAnalysisFailure(() => withAnalysis(input.assetId, 'frames', async request => {
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
    editText: createTool({ description: "Change an existing caption or graphic's text and save immediately. Preserve its timing and style.", inputSchema: z.object({ clipId: z.string(), text: z.string().max(2000) }), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId); if (clip.kind !== "caption" && clip.kind !== "graphic") throw new Error("Choose a caption or text graphic");
      return patchClip(t, input.clipId, { text: input.text });
    }) }),
    styleCaptions: createTool({ description: "Batch-style existing captions and text graphics using exact clipIds. Without IDs, target captions only. Compose a custom style with installed font, size, weight, italic, spacing, line height, alignment, text-box padding/radius, solid colors, position, rotation, blend, stroke/shadow/glow and optional textCase in one call. Presets are optional starting points, not a requirement. Preserve words unless textCase is explicitly requested, and always preserve timing. Preserve its animation unless explicitly supplied; animation replaces the prior selection independently of appearance. Save immediately.", inputSchema: z.object({ clipIds: z.array(z.string()).min(1).max(200).optional(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), rotation:z.number().min(-360).max(360).optional(),textStyle:textStyleInput.optional(), textCase:z.enum(['sentence','upper','lower']).optional(), animation:z.enum(TEXT_ANIMATION_PRESETS).optional() }), execute: async (_ctx, input) => checkpoint(t => {
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
    styleTextClip: createTool({ description: "Style a selected caption/text graphic's requested font, size, solid colors, position, rotation, animation or blend. Preserve omitted controls, words and timing. Appearance and animation are separate; an explicit animation replaces the prior selection. Save immediately.", inputSchema: z.object({ clipId: z.string(), fontSize: z.number().min(8).max(300).optional(),fontFamily:fontFamily.optional(), color: textColor.optional(), background: textColor.optional(), blendMode: z.enum(BLEND_MODES).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), rotation:z.number().min(-360).max(360).optional(), textStyle:textStyleInput.optional(), animation:z.enum(TEXT_ANIMATION_PRESETS).optional() }), execute: async (_ctx, input) => checkpoint(t => {
      const { clipId, rotation,animation, ...style } = input; const clip = find(t, clipId);
      if (clip.kind !== "caption" && clip.kind !== "graphic") throw new Error("Choose a caption or text graphic");
      if (rotation===undefined&&animation===undefined&&!Object.values(style).some(value => value !== undefined)) throw new Error("Specify a text style change");
      const next=rotation!==undefined||Object.values(style).some(value=>value!==undefined)?patchTextStyles(t,{...style,...(rotation!==undefined?{rotation}:{})},[clipId]):t;
      return animation!==undefined?patchClip(next,clipId,textAnimationPatch(find(next,clipId),animation)):next;
    }) }),
    setTextGradient:createTool({description:"Set static or animated gradient fill on exact caption/text-graphic clipIds, batching matching settings in one call. enabled:false restores the saved solid color. Use2–5 hex colors and angle0–360deg. Optional animation enabled:true moves the gradient inside stationary or independently moving letters; duration.2–60 is seconds per pass, direction forward/reverse, loop:true smoothly moves back and forth. animation enabled:false freezes to a static full-width gradient. Omitted controls preserve current gradient settings; enabling a new gradient defaults white/purple90deg. Preserve words, backgrounds, font, text movement, word timing, and clip duration. No footage analysis needed for known editable text. Karaoke's active-word highlight remains readable; other main lettering receives gradient fill, while accent echoes/outlines keep their colors.",inputSchema:z.object({clipIds:clipIdsInput,enabled:z.boolean(),colors:z.array(textColor.refine(color=>color!=='transparent')).min(2).max(5).optional(),angle:z.number().min(0).max(360).optional(),animation:z.object({enabled:z.boolean(),duration:z.number().min(.2).max(60).optional(),direction:z.enum(['forward','reverse']).optional(),loop:z.boolean().optional()}).strict().optional()}).strict(),execute:async(_ctx,{clipIds,...changes})=>checkpoint(t=>{const patches=new Map(clipIds.map(id=>[id,textGradientPatch(find(t,id),changes)]));return {...t,clips:t.clips.map(clip=>patches.has(clip.id)?{...clip,...patches.get(clip.id)}:clip)};})}),
    setTextStyle:createTool({description:"Design a caption/text graphic appearance from individual controls, without selecting a preset: fontWeight100..900 (clamped to the installed face), italic, letterSpacing -10..100px, lineHeight .5..3, textAlign left/center/right, paddingX/Y and borderRadius0..200px, plus stroke, shadow and glow. Pixel values use a 1080 shorter output dimension; 0 width/blur disables that feature. Colors are six-digit hex. Preserve omitted controls, words, timings, fonts, position, rotation and independent text animation. Saves immediately.",inputSchema:textStyleInput.extend({clipId:z.string()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a text appearance control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>{const clip=find(t,clipId);if(clip.kind!=='caption'&&clip.kind!=='graphic')throw new Error('Choose a caption or text graphic.');return patchClip(t,clipId,{textStyle:{...resolvedTextAppearance(clip),...changes}})})}),
    applyTextLook:createTool({description:"Apply a requested text look, or one justified by authorized creative text styling, to a caption/graphic. Styles set solid fill/background/size/blend/stroke/shadow/glow only. Every style preserves the existing animation, custom motion, effect color, strength, timing, stagger and word timings. Default text resets appearance only; Neon Echo does not add or replace motion. Words, clip timing, position, rotation and font remain. Use setTextAnimation only when the user requests an animation change.",inputSchema:z.object({clipId:z.string(),look:z.enum(TEXT_LOOKS.map(look=>look.id))}),execute:async(_ctx,{clipId,look})=>checkpoint(t=>patchClip(t,clipId,textLookPatch(find(t,clipId),look)))}),
    setTextAnimation:createTool({description:"Choose a supported caption/graphic animation independently of text appearance: None, Fade, Rise, Pop in, Word reveal, Pop-in words, Sliding title, Karaoke, Neon Echo, Lyric Slam, Kinetic Stack, Chromatic split, Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on or Echo tunnel. Replace the prior animation, preserve words/style/font/rotation/timing. Karaoke preserves saved speech-word timings when present; otherwise it uses even duration progress, not detected syllables or beat sync.",inputSchema:z.object({clipId:z.string(),animation:z.enum(TEXT_ANIMATION_PRESETS)}),execute:async(_ctx,{clipId,animation})=>{const saved=await checkpoint(t=>patchClip(t,clipId,textAnimationPatch(find(t,clipId),animation)));return {...saved,effectiveAnimation:TEXT_ANIMATION_LABELS[animation]}}}),
    applyCaptionStyle:createTool({description:"Caption clips only: copy an existing caption's appearance to all saved captions, or exact caption targetClipIds. For graphic titles use styleCaptions with exact clipIds instead. Copy font, size, solid colors, position, rotation, blend, stroke/shadow/glow only. Every target keeps its own words, timing and animation. No transcription or new captions.",inputSchema:z.object({sourceClipId:z.string(),targetClipIds:z.array(z.string()).min(1).max(200).optional()}),execute:async(_ctx,{sourceClipId,targetClipIds})=>checkpoint(t=>applyCaptionStyle(t,sourceClipId,targetClipIds))}),
    setCaptionTiming:createTool({description:"Set an existing caption's absolute timeline start/end in seconds, snapped to project frames. Preserve its spoken words and original animation phase; do not generate text, move footage or change neighboring captions. Refuse ranges shorter than one frame or overlapping another clip on its V track.",inputSchema:z.object({clipId:z.string(),start:z.number().min(0).optional(),end:z.number().min(0).optional()}).refine(input=>input.start!==undefined||input.end!==undefined,{message:'Specify caption start or end.'}),execute:async(_ctx,{clipId,...range})=>checkpoint(t=>updateCaptionTiming(t,clipId,range))}),
    configureAudio:createTool({description:"Configure explicitly requested audio fades/role or lower music under voice clips. A linked video targets its separate audio. role original/voice/music is a user label, never inferred speech detection. Only music with ducking.enabled is attenuated during audible voice-labeled clip coverage; amount 0..1 is attenuation, attack/release seconds shape entry/recovery. Fades are timeline seconds at clip edges; preserve source/playback rate/timing/volume and omitted controls. No analysis is needed.",inputSchema:z.object({clipId:z.string(),role:z.enum(AUDIO_ROLES).optional(),fadeIn:z.number().min(0).max(AUDIO_LIMITS.fadeIn[1]).optional(),fadeOut:z.number().min(0).max(AUDIO_LIMITS.fadeOut[1]).optional(),ducking:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),attack:z.number().min(0).max(AUDIO_LIMITS.attack[1]).optional(),release:z.number().min(0).max(AUDIO_LIMITS.release[1]).optional()}).refine(input=>Object.values(input).some(value=>value!==undefined),{message:'Specify a music ducking control.'}).optional()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify an audio control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>configureAudio(t,clipId,changes))}),
    setVolume: createTool({ description: "Set volume from 0 (muted) through 1 (100%, original volume) to 2 (200%, boosted). A linked video controls its separate audio clip.", inputSchema: z.object({ clipId: z.string(), volume: z.number().min(0).max(2) }), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId); if (clip.kind !== "video" && clip.kind !== "audio") throw new Error("Choose a video or audio clip"); return patchClip(t, clip.id, { volume: input.volume });
    }) }),
    addSubtitlesFromTranscript: createTool({ description: "Add readable captions from this asset's saved transcript to each retained source occurrence. Saved word evidence creates phrases of at most six words with measured speech-synced highlights; source trims and playback speed map their exact timings. Discarded words never reappear. Without word evidence, only fully retained sentence segments can be captioned; partial segment text is never guessed. Never invent spoken text.", inputSchema: z.object({ assetId: z.string() }), execute: async (_ctx, input) => savedCheckpoint(input.assetId,t => {
      const asset = assets.find(a => a._id === input.assetId); const rawTranscript = asset?.analysis?.transcript;
      if (!rawTranscript || (!rawTranscript.words.length && !rawTranscript.segments.length)) throw new Error("Run Auto subtitles on this source first; no transcript is saved");
      const transcript = asset.analysis?.audioActivity ? refineTranscriptWithAudioActivity(rawTranscript, asset.analysis.audioActivity) : rawTranscript;
      const captions = t.clips.filter(clip => clip.assetId === input.assetId).flatMap(clip => captionClipsFromTranscript(clip, transcript, t.fps, () => crypto.randomUUID()));
      if (!captions.length) throw new Error("Add a source clip that overlaps its transcript before adding subtitles");
      return captions.reduce((timeline, clip) => placeOnFreeLayer(timeline, clip), t);
    }) }),
    markMusicBeats: createTool({ description: "Add orange markers in a specific audio clip without moving or cutting clips. Choose kind beats for musical pulse (default), downbeats for bar starts, accents for main/strong/audible hits useful for flashes or zooms, or dropCandidates for uncertain energy rises. Never substitute every beat for requested main hits. Analyze automatically if the current requested map is missing. Optional start/end are timeline seconds within that clip. Preserve existing markers and avoid duplicates. Drop candidates are possible drops to check by ear, not verified musical drops; inspect their evidence and explain uncertainty first unless the user explicitly requests candidate markers.", inputSchema: z.object({ clipId: z.string(), kind: z.enum(['beats', 'downbeats', 'accents', 'dropCandidates']).optional(), start: z.number().min(0).optional(), end: z.number().positive().optional() }), execute: async (_ctx, input) => {
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
    setAudioReactive: createTool({ description: "Make clips react to music: a level curve from one song's detected beats (pulse on each hit, instant attack, `decay` release) or its loudness (energy) drives up to 4 targets per clip. CSS targets work on footage, images, text and solids: scale (amount -0.5..0.5, e.g. 0.06 = 6% bump), shake (0..0.1 of the frame, e.g. 0.01), rotate (-20..20 degrees). Effect controls work on video/image: any keyframeable control such as colorGrade.exposure (0.3), glitch.intensity (0.6), zoomBlur.amount (0.4), lightLeak.amount, softBlur.amount, lensDistortion.amount; the amount is added at full level and is 0 in silence. Modes: beats, downbeats (bar starts), accents (strong hits), energy (follows loudness; sensitivity 0..1). Subtle defaults read best: scale 0.04-0.08 on beats, glitch on accents. Covers each clip's own time span (up to 4 minutes). clear:true removes it. Rendered identically in preview and export.", inputSchema: z.object({ clipIds: clipIdsInput, musicClipId: z.string().min(1).optional().describe('The audio clip whose sound drives the reaction; omit when clear'), mode: z.enum(['beats', 'downbeats', 'accents', 'energy']).optional(), targets: z.array(z.object({ property: z.string().min(1).max(60).describe(`${CSS_REACTIVE_TARGETS.join(', ')} or group.control`), amount: z.number() }).strict()).min(1).max(4).optional(), sensitivity: z.number().min(0).max(1).optional(), decay: z.number().min(.03).max(1.5).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => {
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
    addMarker:createTool({description:"Add an explicitly requested ordinary timeline cue at user-provided seconds, snapped to project frames, with an optional user-provided label. Preserve clips and existing cues; an occupied frame adds no duplicate. This does not analyze audio or claim a measured beat/hit. For measured musical markers use markMusicBeats instead.",inputSchema:z.object({time:z.number().min(0),label:z.string().min(1).max(120).optional()}),execute:async(_ctx,{time,label})=>checkpoint(t=>addTimelineMarker(t,time,crypto.randomUUID(),label??null))}),
    moveMarker:createTool({description:"Move one existing ordinary or measured cue by exact markerId from inspectTimeline to explicitly requested timeline seconds, snapped to frames. Preserve its ID/label and every other cue/clip. This manual move does not analyze music or assert a new measured beat.",inputSchema:z.object({markerId:z.string().min(1).max(100),time:z.number().min(0)}),execute:async(_ctx,{markerId,time})=>checkpoint(t=>{if(!t.markers?.some(marker=>marker.id===markerId))throw new Error('Choose an existing timeline marker ID.');return moveTimelineMarker(t,markerId,time)})}),
    removeMarker: createTool({ description: "Remove one orange timeline marker using its exact marker ID from inspectTimeline. Leaves all clips and other markers unchanged; works even when the marker has no label. An already absent ID makes no change. Returns actual removedMarkerIds and removed count.", inputSchema: z.object({ markerId: z.string().min(1).max(100) }), execute: async (_ctx, input) => markerCheckpoint(t => removeTimelineMarker(t, input.markerId)) }),
    removeMarkers: createTool({ description: "Remove orange timeline markers without touching clips. Choose scope all only when asked to remove or clear all markers; choose selected with exact markerIds from inspectTimeline for a specific set. Labels are optional, so use IDs. Returns actual removedMarkerIds and removed count, including zero when no markers matched.", inputSchema: z.object({ scope: z.enum(['all', 'selected']), markerIds: z.array(z.string().min(1).max(100)).min(1).max(1000).optional() }).refine(input => input.scope === 'selected' ? input.markerIds !== undefined : input.markerIds === undefined, { message: 'Use selected with markerIds, or all without markerIds.' }), execute: async (_ctx, input) => markerCheckpoint(t => removeTimelineMarkers(t, input.scope === 'all' ? undefined : input.markerIds)) }),
    alignCutsToBeat: createTool({ description: "Move shot boundaries to this music source's current dedicated beat-tracking map. Run analyzeMedia mode beats first if the map is missing or came from the legacy onset detector. Sources must be on the timeline and long enough for the adjusted cuts.", inputSchema: z.object({ musicAssetId: z.string() }), execute: async (_ctx, input) => savedCheckpoint(input.musicAssetId,t => {
      const music = assets.find(a => a._id === input.musicAssetId); const map = music?.analysis?.beats; const beats = map?.beats;
      if (map?.engine !== BEAT_ANALYSIS_ENGINE || !beats?.length) throw new Error("Run Find beats on this source first; no current dedicated beat map is saved");
      return alignCutsToBeats(t, assets.map(asset => ({ ...asset, url: null })), input.musicAssetId, beats);
    }) }),
    useStrongestMoment: createTool({ description: "Use the highest-scored scene from a saved footage understanding result. Replace this source's first video shot, or append a shot if it has not been used. Never guess a source moment.", inputSchema: z.object({ assetId: z.string() }), execute: async (_ctx, input) => savedCheckpoint(input.assetId,t => {
      const asset = assets.find(a => a._id === input.assetId); const scenes = asset?.analysis?.understanding?.scenes;
      if (asset?.kind !== "video" || !scenes?.length) throw new Error("Run Understand footage on this video first; no scene analysis is saved");
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
    }) }),
    inspectAssetAnalysis: createTool({ description: "Read this media's saved transcript, scene descriptions and measured shot boundaries. The default transcript includes sentence segments and a word-timing read hint. Supply start/end SOURCE seconds for the relevant sentence, preferably windows up to 30 seconds, to receive exact overlapping words with text/start/end. To read several sentences, pass them together as windows (up to eight) in ONE call rather than calling this tool once per window. Measured source audio quiet intervals, dense subject tracking and beat samples are summarized by default; ranged reads return their exact samples. Audio energy is not a visual observation or proof of silence. Visual descriptions remain intact. If absent, analysis has not been run; never invent results.", inputSchema: z.object({ assetId: z.string(), start: z.number().min(0).optional(), end: z.number().positive().optional(), windows: z.array(z.object({ start: z.number().min(0), end: z.number().positive() })).min(1).max(8).optional() }).refine(input => (input.start === undefined && input.end === undefined) || (input.start !== undefined && input.end !== undefined && input.end > input.start), { message: 'Provide a valid start/end SOURCE range together.' }), execute: async (_ctx, input) => {
      let asset = await loadAsset(input.assetId);
      // Transcripts made before windowed transcription merged repeated takes
      // and dropped speech. Refresh one before the model plans cuts from it;
      // a failed refresh is not retried by every later read in this run.
      if (asset.analysis?.transcript && !currentTranscript(asset.analysis.transcript) && !transcriptRefreshFailures.has(asset._id)) {
        try { asset = await analyze(asset._id, 'transcribe'); }
        catch (error) { transcriptRefreshFailures.set(asset._id, error instanceof Error ? error.message : 'unknown error'); }
      }
      const transcriptNote = asset.analysis?.transcript && !currentTranscript(asset.analysis.transcript) ? `This transcript predates current transcription and may merge repeated takes or miss speech${transcriptRefreshFailures.has(asset._id) ? `; refreshing it failed (${transcriptRefreshFailures.get(asset._id)})` : ''}. Treat lines missing from it as unverified, not absent, and ask the user rather than watching the footage to find them.` : undefined;
      if (!asset.analysis) return { assetId: asset._id, unavailable: true };
      const read = input.windows ? modelAssetAnalysisWindows(asset.analysis, input.windows) : modelAssetAnalysis(asset.analysis, input.start !== undefined && input.end !== undefined ? { start: input.start, end: input.end } : undefined);
      return { assetId: asset._id, ...read, ...(transcriptNote ? { transcriptNote } : {}) };
    } }),
    closeGaps: createTool({ description: "Join footage after cuts: close every gap between video/image clips on each visual layer in ONE saved change, moving later clips earlier with their linked audio. Retained source ranges, speed and styling are unchanged. Optional clipIds (two or more) limits it to those clips. Use this instead of moving clips one at a time.", inputSchema: z.object({ clipIds: clipIdsInput.optional() }), execute: async (_ctx, input) => checkpoint(t => closeFootageGaps(t, input.clipIds ?? [])) }),
    retainSourceRanges: createTool({ description: "Keep ordered SOURCE-time ranges from one existing video/audio clip and compact them at that clip's timeline start in one change. For any speech cut use tightenSilence:true: the source's measured speech cleanup then runs automatically inside the kept ranges (pauses, breaths and filler words removed between words) and every edge snaps to the measured sound of its words, to the millisecond; report its speechCleanup summary to the user. keepPauses:true keeps natural pauses and fillers (only edges are tightened) when the user asks for that. Without a cleanup map, outer quiet edges are tightened with 80ms padding. Omit tightenSilence for exact user-requested timestamp cuts. Every requested range must fit the current retained source; never restore removed footage. Preserve speed, styling, motion/fade phase and linked audio. Without tightenSilence edges round outward to project frames unless exactEdges:true. Other clips/tracks/markers keep their positions; no global ripple. Refuses transition-connected sources. Inspect actual retained ranges before adding subtitles.", inputSchema: z.object({ clipId: z.string().min(1).max(100), ranges: z.array(z.object({ start: z.number().min(0), end: z.number().positive() }).strict()).min(1).max(100), tightenSilence: z.boolean().optional(), keepPauses: z.boolean().optional(), exactEdges: z.boolean().optional() }), execute: async (_ctx, input) => {
      let evidence: (typeof assets)[number] | undefined;
      if (input.tightenSilence) {
        const speech = await speechEvidence(input.clipId);
        if (speech.cleanup) {
          // Validate the request as asked before measured adjustment.
          retainSourceRanges(editSession.timeline, input.clipId, input.ranges, undefined, true);
          return applySpeechCut(input.clipId, speech, input.ranges, input.keepPauses ? new Set() : new Set(['pause', 'breath', 'filler']), .6);
        }
        evidence = speech.evidence;
      }
      let ranges: RetainedRangeSummary[] = [];
      let tightened = false;
      const result = await checkpoint(t => {
        // Validate the original request before any measured adjustment.
        let retained = retainSourceRanges(t, input.clipId, input.ranges, undefined, input.exactEdges);
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
        ranges = retained.ranges; return retained.timeline;
      });
      return { ...result, retainedRanges: ranges, ...(evidence ? { silenceRefinement: { status: tightened ? 'applied' : evidence.analysis?.audioActivity?.reliable ? 'unchanged' : 'unreliable', evidenceAssetId: evidence._id, paddingSeconds: AUDIO_QUIET_EDGE_PAD } } : {}) };
    } }),
    cleanSpeech: createTool({ description: "Remove filler words, breaths, pauses and abandoned retakes from one existing video/audio clip in ONE change, using the source's measured speech cleanup map. Each cut sits between words, never inside one; a retake keeps only its final attempt; every edge snaps to measured word sound, to the millisecond. Cuts below minConfidence (default 0.6) are kept; kinds limits what is removed (default all). preview:true returns the proposed cuts without editing. To assemble chosen takes prefer retainSourceRanges with tightenSilence:true, which applies the same cleanup inside the kept ranges; keep here does the same. Kept pieces compact at the clip's timeline start with linked audio, speed and styling preserved; other clips keep their positions, so close gaps afterwards when needed. Use for 'remove ums', 'cut the pauses', 'clean up the retakes' on a clip as a whole; report its speechCleanup summary.", inputSchema: z.object({ clipId: z.string().min(1).max(100), minConfidence: z.number().min(0).max(1).optional(), kinds: z.array(z.enum(['pause', 'breath', 'filler', 'restart'])).min(1).max(4).optional(), preview: z.boolean().optional(), keep: z.array(z.object({ start: z.number().min(0), end: z.number().positive() }).strict()).min(1).max(100).optional() }), execute: async (_ctx, input) => {
      if (input.keep?.some((range, index) => range.end <= range.start || (index > 0 && range.start < input.keep![index - 1].end))) throw new Error('keep ranges must be ordered and non-overlapping.');
      const speech = await speechEvidence(input.clipId);
      if (!speech.cleanup) throw new Error('Speech cleanup measurements are unavailable for this source. The media processor has not measured it yet; trim with retainSourceRanges instead.');
      const kinds = new Set<string>(input.kinds ?? (input.keep ? ['pause', 'breath', 'filler'] : ['pause', 'breath', 'filler', 'restart']));
      const chosen = input.keep ?? [{ start: speech.clip.sourceStart, end: speech.sourceEnd }];
      return applySpeechCut(input.clipId, speech, chosen, kinds, input.minConfidence ?? .6, input.preview);
    } }),
    setSplitEdits: createTool({ description: "Make J and L cuts at existing video cuts in ONE change. Each edit names the video clip BEFORE the cut. L: the outgoing sound carries over while the picture changes early (reaction or B-roll lands under the end of a line). J: the next line's sound starts while the previous picture is still showing, then the picture follows. seconds is how far the picture edit moves (subtle: 0.1 to 0.2 is usually enough; at most 2). Sound, speech cleanup and caption timing stay exactly where they are; only the picture edit point moves, using the source footage beside each piece, and those video clips are unlinked from their sound. Use for 'add J/L cuts', 'smoother cuts', 'let the audio lead'. Inspect the timeline first for the clip IDs.", inputSchema: z.object({ edits: z.array(z.object({ clipId: z.string().min(1).max(100), kind: z.enum(['J', 'L']), seconds: z.number().positive().max(MAX_SPLIT_EDIT_SECONDS) }).strict()).min(1).max(100) }), execute: async (_ctx, input) => checkpoint(t => input.edits.reduce((timeline, edit) => applySplitEdit(timeline, edit.clipId, edit.kind, edit.seconds, assetId => assets.find(asset => asset._id === assetId)?.duration), t)) }),
    split: createTool({ description: "Split an existing clip at a timeline time in seconds. Source edits remain staged until the request completes. For a speech cut with several retained source ranges, prefer retainSourceRanges instead of a split/trim/delete chain.", inputSchema: z.object({ clipId: z.string(), time: z.number().min(0) }), execute: async (_ctx, input) => checkpoint(t => splitClip(t, input.clipId, input.time, crypto.randomUUID())) }),
    trim: createTool({ description: "Change duration and optional SOURCE trim start, in seconds. Use clipId/duration/sourceStart for one clip, OR edits:[{clipId,duration,sourceStart?}] for several independently specified trims in ONE validated operation. Prefer edits when several trim ranges are already known. Never supply both forms; target each linked pair only once because its audio stays synchronized automatically. Media source edits remain staged until completion. Effect clips have no source trim: duration stretches their animation. A duration that would run into the next clip on the same layer is refused with the room available.", inputSchema: z.object({ clipId:z.string().min(1).optional(),duration:z.number().positive().optional(),sourceStart:z.number().min(0).optional(),edits:z.array(trimChangeInput).min(1).max(200).refine(edits=>new Set(edits.map(edit=>edit.clipId)).size===edits.length,{message:'Choose unique clip IDs.'}).optional() }).strict().refine(input=>input.edits!==undefined?input.clipId===undefined&&input.duration===undefined&&input.sourceStart===undefined:input.clipId!==undefined&&input.duration!==undefined,{message:'Specify one clipId/duration or an edits array.'}), execute: async (_ctx, input) => checkpoint(t => {
      const edits=input.edits??[{clipId:input.clipId!,duration:input.duration!,sourceStart:input.sourceStart}];
      const ids=new Set(edits.map(edit=>edit.clipId));
      for(const edit of edits){const clip=find(t,edit.clipId);if(clip.linkedClipId&&ids.has(clip.linkedClipId))throw new Error('Trim each linked pair once; its matching audio follows automatically.');}
      let next=t;
      for(const edit of edits){const clip=find(next,edit.clipId);next=trimClip(next,clip.id,edit.duration,edit.sourceStart);}
      return next;
    }) }),
    move: createTool({ description: "Move a clip in seconds or within its own track group: effects use FX1–FX24, video/images/text/solid-color use V1–V24, and audio uses A1–A12. The clip kind determines the group; Legacy solid-color FX can be explicitly converted using convertSolidColorToVisual before moving onto V. Start snaps to project frames; an occupied layer bumps the clip to the next free layer, and linked audio moves with its video exactly as a manual drag. Save immediately.", inputSchema: z.object({ clipId: z.string(), start: z.number().min(0).optional(), track: z.number().int().min(1).max(24).optional() }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (input.start === undefined && input.track === undefined) throw new Error("Specify a timeline start or a layer"); return moveClipTo(t, clip.id, input.start, input.track); }) }),
    delete: createTool({ description: "Stage removal of one clip with clipId, OR several exact clips together with clipIds in ONE operation. Prefer clipIds when all removal targets are already known; never supply both. Existing linked-pair deletion behavior is preserved: unlink first when keeping the original audio or video partner. Validate every target before changing the draft; publish only after the request completes successfully.", inputSchema: z.object({clipId:z.string().min(1).optional(),clipIds:clipIdsInput.optional()}).strict().refine(input=>(input.clipId!==undefined)!==(input.clipIds!==undefined),{message:'Choose clipId or clipIds, never both.'}), execute: async (_ctx, input) => checkpoint(t => {const ids=input.clipIds??[input.clipId!];for(const id of ids)find(t,id);let next=t;for(const id of ids)if(next.clips.some(clip=>clip.id===id))next=deleteClip(next,id);return next;}) }),
    addCaption: createTool({ description: "Add a timed caption with explicit text, styling and normalized position; save immediately. Without a background it sits on a dark box, unless textStyle sets an outline (strokeWidth), which reads on the footage itself.", inputSchema: textInput, execute: async (_ctx, {textStyle,...input}) => checkpoint(t => placeOnFreeLayer(t, { id: crypto.randomUUID(), kind: "caption", sourceStart: 0, fontSize: 52, color: "#F4F4F0", background: textStyle?.strokeWidth ? "transparent" : "#0B0C0E", x: 0.5, y: 0.82, animation: "none", ...input, ...(textStyle?{textStyle:{...resolvedTextAppearance({kind:"caption"}),...textStyle}}:{}) })) }),
    addGraphic: createTool({ description: "Add a text motion graphic with explicit text, styling and normalized position; save immediately.", inputSchema: textInput, execute: async (_ctx, {textStyle,...input}) => checkpoint(t => placeOnFreeLayer(t, { id: crypto.randomUUID(), kind: "graphic", sourceStart: 0, fontSize: 92, color: "#F4F4F0", background: "transparent", x: 0.5, y: 0.5, animation: "none", ...input, ...(textStyle?{textStyle:{...resolvedTextAppearance({kind:"graphic"}),...textStyle}}:{}) })) }),
    readSkill: createTool({ description: "Load the full instructions for one format-specific editing skill listed under skills in the catalog. Read a skill once per conversation, before first using the tools it names; an earlier read stays in the conversation, so do not read it again. it returns Markdown rules, the API and an example. No timeline changes.", inputSchema: z.object({ name: z.enum(EDITOR_SKILL_NAMES) }), execute: async (_ctx, { name }) => { const skill = editorSkill(name); return { name: skill.name, instructions: skill.body }; } }),
    addScene: createTool({ description: "Add one animated explainer scene: a React component module (code) rendered full-frame on a free V layer for start..start+duration timeline seconds. Read the explainer-scenes skill first. Then, in the same turn, generate the scene's matching sound with one generateSound clip keyed to its beats unless the user wants no sound or speech/music plays under it. Returns compile errors for invalid code; save immediately.", inputSchema: z.object({ title: z.string().trim().min(1).max(SCENE_LIMITS.title), code: z.string().min(1).max(SCENE_LIMITS.code), start: z.number().min(0), duration: z.number().positive().max(120), track: z.number().int().min(1).max(24).optional() }), execute: async (_ctx, { title, code, ...timing }) => { checkSceneCode(code); return checkpoint(t => placeOnFreeLayer(t, { id: crypto.randomUUID(), kind: 'scene', sourceStart: 0, ...timing, scene: { title, code } })); } }),
    editScene: createTool({ description: "Replace an existing scene clip's code and/or title, preserving its timing and layer. Read the explainer-scenes skill and inspectClip for the current code first. If the edit changes the scene's timing or motion, update its existing generated sound with editSound in the same turn (or generate one if it has none). Returns compile errors for invalid code; save immediately.", inputSchema: z.object({ clipId: z.string(), title: z.string().trim().min(1).max(SCENE_LIMITS.title).optional(), code: z.string().min(1).max(SCENE_LIMITS.code).optional() }).refine(input => input.title !== undefined || input.code !== undefined, { message: 'Specify a title or code.' }), execute: async (_ctx, { clipId, title, code }) => { if (code !== undefined) checkSceneCode(code); return checkpoint(t => { const clip = find(t, clipId); if (clip.kind !== 'scene' || !clip.scene) throw new Error('Choose a scene clip.'); return patchClip(t, clipId, { scene: { title: title ?? clip.scene.title, code: code ?? clip.scene.code } }); }); } }),
    addMedia: createTool({ description: "Add this project's uploaded video/image on a shared visual track (1–24), or audio on an audio track (1–12); save immediately.", inputSchema: z.object({ assetId: z.string(), track: z.number().int().min(1).max(24).optional(), start: z.number().min(0), duration: z.number().positive(), sourceStart: z.number().min(0) }), execute: async (_ctx, input) => checkpoint(t => { const asset = assets.find(a => a._id === input.assetId); if (!asset) throw new Error("Choose media from this project"); if (recovering && t.clips.some(clip => clip.assetId === input.assetId && Math.abs(clip.start-input.start) < 1/t.fps && Math.abs(clip.duration-input.duration) < 1/t.fps && Math.abs(clip.sourceStart-input.sourceStart) < 1/t.fps)) return t; const id = crypto.randomUUID(); const next = addMediaClip(t, { ...asset, duration: input.duration }, id, input.start, input.track ?? 1); return patchClip(next, id, { sourceStart: input.sourceStart, duration: input.duration }); }) }),
    addSoundEffect: createTool({ description: "Place one recorded CC0 library sound (ids listed under Library in the music-and-sound skill) at its full length on a free A layer at timeline seconds at, frame-snapped; save immediately. Use ONLY when the user explicitly asks for a realistic or recorded sound that the library has (camera shutter, phone vibrate, clock, lock, water, ambience such as city, ocean or server room) or names a library sound; place it at exactly the time they give or the moment they describe. Never add library sounds on your own initiative or mix them into motion-graphics sound design: generate those with generateSound. gain is the clip volume 0..2 (default 0.7). Read the music-and-sound skill first. Returns the clip and any audible non-effect audio it overlaps.", inputSchema: z.object({ effect: z.enum(STOCK_AUDIO_IDS), at: z.number().min(0), gain: z.number().min(0).max(2).optional() }), execute: async (_ctx, { effect, at, gain = .7 }) => {
      const sound = stockAudio(effect)!;
      let asset = assets.find(item => item.r2Key === sound.r2Key);
      if (!asset) { asset = await ctx.runMutation(internal.assistant.attachRunStockAudio, { ...run, catalogId: effect }); assets.push(asset); }
      return { ...await placeEffectSound(asset._id, sound.duration, at, gain), effect, name: sound.name, duration: sound.duration };
    } }),
    generateSound: createTool({ description: "The default way to add any sound effect: design it from a JSON recipe, render it (deterministic synth, 48 kHz WAV) and place it on a free A layer at timeline seconds at (frame-snapped); save immediately. Time it exactly to the motion: a whoosh as long as a slide-in, a pop per card, a riser into a hit; layer times are relative to at. When the user gives a time, use exactly that time. Also call it, unasked, after addScene or a choreography-changing editScene: one clip per scene at its start. Read the music-and-sound skill first. gain is the clip volume 0..2 (default 0.7); renders peak at -3 dBFS. Returns the clip, its duration and any audible non-effect audio it overlaps.", inputSchema: z.object({ recipe: soundRecipeInput, at: z.number().min(0), gain: z.number().min(0).max(2).optional(), name: z.string().trim().min(1).max(60).optional() }), execute: async (_ctx, { recipe, at, gain = .7, name }) => {
      const asset = await createGeneratedSound(recipe, name);
      return { ...await placeEffectSound(asset._id, asset.duration!, at, gain), name: asset.fileName, duration: asset.duration };
    } }),
    editSound: createTool({ description: "Replace a generated sound clip's recipe and re-render it, keeping its start, layer and volume (it moves up a layer only if the new length would overlap). Read inspectClip for the current recipe first; send the whole new recipe. Library sounds cannot be edited; delete and replace them.", inputSchema: z.object({ clipId: z.string(), recipe: soundRecipeInput, name: z.string().trim().min(1).max(60).optional() }), execute: async (_ctx, { clipId, recipe, name }) => {
      await editSession.wait();
      const current = find(editSession.timeline, clipId);
      const previous = assets.find(item => item._id === current.assetId);
      if (current.kind !== 'audio' || !previous?.soundRecipe) throw new Error('Choose a generated sound clip; library and uploaded audio have no recipe.');
      const asset = await createGeneratedSound(recipe, name ?? previous.fileName.replace(/\.wav$/, ''));
      const result = await checkpoint(t => { const clip = find(t, clipId); return placeOnFreeLayer(t, { ...clip, assetId: asset._id, sourceStart: 0, duration: asset.duration! }); });
      return { ...result, clipId, name: asset.fileName, duration: asset.duration };
    } }),
    addLayer: createTool({ description: "Add an empty effects-only FX track (up to 24), shared visual V track (up to 24), or audio A track (up to 12). Only effect clips belong to FX tracks. Video, images, captions and graphics share V tracks.", inputSchema: z.object({ group: z.enum(["effects", "visual", "audio"]) }), execute: async (_ctx, input) => checkpoint(t => { const tracks = deriveTrackCounts(t); const maximum = maxTrackCount(input.group); if (tracks[input.group] >= maximum) throw new Error(`This group already has ${maximum} tracks`); return { ...t, tracks: { ...tracks, [input.group]: tracks[input.group] + 1 } }; }) }),
    deleteEmptyLayer: createTool({ description: "Delete one EMPTY FX, V or A track without deleting clips. group effects means FX, visual means V, audio means A; track is its current number. Refuses occupied tracks. Higher tracks are renumbered while timing, stacking order, media and linked audio remain intact. Inspect current track numbers again after deletion if needed. Saves immediately.", inputSchema: z.object({ group: z.enum(['effects', 'visual', 'audio']), track: z.number().int().min(1).max(24) }), execute: async (_ctx, input) => checkpoint(t => deleteEmptyLayer(t, input.group, input.track)) }),
    removeEmptyLayers: createTool({ description: "When the user asks to clean up ALL empty tracks, remove every empty effects/visual/audio track in one saved change. Never deletes clips, changes timing or alters stacking order; occupied FX/V/A tracks become contiguous within their own group.", inputSchema: z.object({}), execute: async () => checkpoint(removeEmptyLayers) }),
    configureSmoothZoom:createTool({description:"Add one smooth zoom-in, optional hold and return on a video/image. start uses TIMELINE seconds; inDuration/holdDuration/outDuration use timeline seconds, independent of playback speed. outDuration:0 holds the zoom through the clip end. scale1..10, easing linear/ease-in-out/ease-out/focused-spring. focused-spring gives a snappy, smoothly settling zoom without bounce; choose it for requested focused or spring-style camera zooms. ease-out starts fast and brakes smoothly. focus center is only for a generic centered zoom. For a named modal, cursor or object, first inspectFrames at a relevant source instant and use its targetId; current-request evidence must match this retained source and zoom window. focus coordinates is only for coordinates explicitly given by the user, in original displayed SOURCE pixels or normalized0..1, never preview-screen pixels. Existing crop/fit maps the target automatically. framing center moves the target toward the canvas center; source-edge limits prevent revealing empty space, so edge targets may remain off-center. anchor keeps it at its existing screen position. Named targets default to center, generic and explicit coordinate focus default to anchor. A nonzero outDuration restores the pre-zoom framing. Do not use static crop or transform changes to simulate a temporary close-up that must return. Preserve linked audio, source trim and static transform. Custom motion requires explicit replaceMotion:true authorization. One validated operation stores canonical motion for preview/export; no per-frame tool calls.",inputSchema:z.object({clipId:z.string().min(1),start:z.number().min(0),inDuration:z.number().positive(),holdDuration:z.number().min(0),outDuration:z.number().min(0),scale:z.number().min(CAMERA_ZOOM_RANGE[0]).max(CAMERA_ZOOM_RANGE[1]),easing:z.enum(SMOOTH_ZOOM_EASINGS),framing:z.enum(['anchor','center']).optional(),replaceMotion:z.boolean().optional(),focus:z.union([z.object({kind:z.literal('center')}).strict(),z.object({kind:z.literal('target'),targetId:z.string().min(1)}).strict(),z.object({kind:z.literal('coordinates'),centerX:z.number(),centerY:z.number(),units:z.enum(VISUAL_INPUT_UNITS).optional()}).strict()])}),execute:async(_ctx,{clipId,focus,...input})=>checkpoint(t=>{
      const clip=find(t,clipId),asset=assets.find(item=>item._id===clip.assetId);
      if(!asset)throw new Error('Choose media from this project.');
      return patchClip(t,clipId,configureSmoothZoomPatch(clip,{...asset,url:null},t.aspectRatio,input,focus,zoomTargets));
    })}),
    configureCameraMotion:createTool({description:"Configure one clip-level camera path for uploaded video/image: zoom, pan/glide, or sampled object/cursor following. Send 2–8 keyframes together in one call, each with TIMELINE time, scale1..10, focus and easing. The destination keyframe easing controls movement into that point. Same scale with changing focus glides; repeated focus/scale holds; the last point holds until clip end. To return wide, include an explicit final scale1 point with the original view center; inspect static framing rather than assuming a cropped/off-center clip has a .5,.5 original view center. The camera moves each source focus toward the center through existing fit/crop/static placement, clamping to the retained source window so it never creates empty edge space. Near an edge the target can remain off-center; do not force exact centering by moving the static clip. Preserve base transform, media trims, speed and linked audio. mode glide means a planned route across static targets. mode follow means sampled movement: inspectFrames at distinct requested SOURCE instants, pass each returned current-request targetId at its matching TIMELINE instant, within one source frame. Do not reuse an old cursor position as a later tracked position or claim continuous tracking between sparse samples. For a named object first inspectFrames; never invent coordinates. Explicit coordinates are only for original-source coordinates provided by the user. Generic center needs no analysis. Existing camera paths/smooth zoom can be replaced; arbitrary custom motion requires explicit user authorization and replaceMotion:true. This affects one footage clip, not text/other layers or the whole scene. Optional blurAmount0..1 adds speed-driven directional blur during camera gliding, default off;0disables. Blur clears on holds/stopped preview and preserves static directionalBlur. No per-frame tool calls.",inputSchema:z.object({clipId:z.string().min(1),mode:z.enum(['glide','follow']).optional(),blurAmount:z.number().min(0).max(1).optional(),replaceMotion:z.boolean().optional(),keyframes:z.array(z.object({time:z.number().min(0),scale:z.number().min(CAMERA_ZOOM_RANGE[0]).max(CAMERA_ZOOM_RANGE[1]),easing:z.enum(SMOOTH_ZOOM_EASINGS),focus:z.union([z.object({kind:z.literal('center')}).strict(),z.object({kind:z.literal('target'),targetId:z.string().min(1)}).strict(),z.object({kind:z.literal('coordinates'),centerX:z.number(),centerY:z.number(),units:z.enum(VISUAL_INPUT_UNITS).optional()}).strict()])}).strict()).min(2).max(8)}).strict(),execute:async(_ctx,{clipId,...input})=>checkpoint(t=>{
      const clip=find(t,clipId),asset=assets.find(item=>item._id===clip.assetId);
      if(!asset)throw new Error('Choose media from this project.');
      return patchClip(t,clipId,configureCameraMotionPatch(clip,{...asset,url:null},t.aspectRatio,input,zoomTargets));
    })}),
    transformClip: createTool({ description: "Set one video/image's static position, scale, rotation or opacity with clipId, OR apply the same requested patch to exact clipIds in one atomic save. Prefer clipIds for the same framing across several clips; never send both target fields. units defaults normalized: center x/y -5..5; 0..1 spans the canvas and off-frame positions are allowed. units pixels uses the canvas reference with shorter dimension1080 (landscape1920×1080, vertical1080×1920), independent of export resolution. Scale0.1..5, rotation degrees±360, opacity0..1. Preserve omitted controls, linked sound and retained source/timing. Reject unknown pixel geometry and invalid/nonvisual targets without saving a partial batch.", inputSchema:z.object({clipId:z.string().min(1).optional(),clipIds:z.array(z.string().min(1)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'}).optional(),...transformFields}).strict().refine(input=>(input.clipId!==undefined)!==(input.clipIds!==undefined),{message:'Choose clipId or clipIds, never both.'}),execute:async(_ctx,input)=>checkpoint(t=>{
      const ids=input.clipIds??[input.clipId!];
      const {units,x,y,scale,rotation,opacity}=input,changes={x,y,scale,rotation,opacity};
      let next=t;
      for(const id of ids)next=patchClip(next,id,transformInputPatch(find(next,id),changes,dimensions(t.aspectRatio),units));
      return next;
    }) }),
    configureVisualFade:createTool({description:"Set an explicitly requested fade in/out on one video or image clip; also builds a crossfade when the incoming clip overlaps the outgoing one. Apply it directly, without planEffects or previewRender. Fade values are timeline seconds; their total must fit the retained clip duration. Use 0 to remove a requested edge fade. Preserve omitted edge controls, static opacity, crop/motion, source range, clip timing, linked audio/gain/fades and every other clip. Explicit fade edits restart this clip's fade phase; later trims/splits retain it. Saves immediately.",inputSchema:z.object({clipId:z.string(),fadeIn:z.number().min(0).max(VISUAL_FADE_MAX_SECONDS).optional(),fadeOut:z.number().min(0).max(VISUAL_FADE_MAX_SECONDS).optional()}).refine(input=>input.fadeIn!==undefined||input.fadeOut!==undefined,{message:'Specify a visual fade in or out.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>configureVisualFade(t,clipId,changes))}),
    animateEffect: createTool({ description: "Keyframe one numeric visual-effect control over time on a VIDEO or IMAGE clip, e.g. a grade that drains colour on a line (colorGrade.saturation 1 to 0.3), a blur-in reveal (softBlur.amount 20 to 0), a light leak that flares on a beat (lightLeak.amount), glitch that ramps up (glitch.intensity), heat haze (turbulentDisplace.amount), lens distortion with chromatic fringing (lensDistortion.amount / .fringing), film or VHS strength, light sweeps, zoom blur, frame bend. control is group.control from the effect controls list (same ranges as setVisualEffects). keyframes use CLIP-LOCAL seconds and absolute values; 1 to 9 anchors, each with optional easing (named, or a cubic-bézier [x1,y1,x2,y2]); values hold before the first and after the last anchor. The animated group is switched on while keyframed and its other controls keep their current or default values, so set those first with setVisualEffects when they matter. Replaces this control's previous keyframes; clear:true removes them. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1), control: z.enum(EFFECT_KEYFRAME_CONTROLS as [string, ...string[]]), keyframes: z.array(z.object({ time: z.number().min(0), value: z.number(), easing: motionEasingInput.optional() }).strict()).max(9).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if (!input.clear && !input.keyframes?.length) throw new Error('Give 1 to 9 keyframes, or clear:true to remove this control\'s keyframes.');
      return patchClip(t, clip.id, effectKeyframesPatch(clip, input.control, input.clear ? null : input.keyframes!));
    }) }),
    setMask: createTool({ description: "Mask a VIDEO or IMAGE clip so only a shape shows (or, with invert, everything except it): rectangle (optional corner radius 0..0.5), ellipse, polygon (3–64 points [x,y] within 0..1 of its box, for freehand shapes) or text (1–40 characters filling its box; the footage shows through the letters). Geometry is canvas fractions of the clip's frame: x/y center, width/height, rotation degrees, feather = soft edge in px at 1080p (0 hard, 20–60 soft). keyframes: 1–9 anchors in CLIP-LOCAL seconds with optional easing (named or cubic-bézier); e.g. a box that grows from the center, an oval vignette that tightens on a punchline, a diagonal wipe, text that reveals B-roll. Use invert with a blurred copy above the footage to blur everything but one area. Replaces this clip's mask; clear:true removes it. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1), shape: z.enum(MASK_SHAPES).optional(), invert: z.boolean().optional(), radius: z.number().min(0).max(.5).optional(), points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(64).optional(), text: z.string().min(1).max(40).optional(), keyframes: z.array(z.object({ time: z.number().min(0), x: z.number().min(-1).max(2), y: z.number().min(-1).max(2), width: z.number().min(.005).max(4), height: z.number().min(.005).max(4), rotation: z.number().min(-360).max(360).optional(), feather: z.number().min(0).max(200).optional(), easing: motionEasingInput.optional() }).strict()).min(1).max(9).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if (input.clear) return patchClip(t, clip.id, { mask: undefined });
      if (!input.shape || !input.keyframes?.length) throw new Error('Give a shape and 1 to 9 keyframes, or clear:true.');
      if (input.keyframes.some(key => key.time > clip.duration + 1e-6)) throw new Error('Mask keyframes must fit inside the clip, in clip-local seconds.');
      const keys = bakeMaskAnchors(input.keyframes.map(key => ({ ...key, rotation: key.rotation ?? 0, feather: key.feather ?? 0 })), clip.motionOffset ?? 0);
      return patchClip(t, clip.id, { mask: { shape: input.shape, ...(input.invert ? { invert: true } : {}), ...(input.radius !== undefined ? { radius: input.radius } : {}), ...(input.points ? { points: input.points } : {}), ...(input.text ? { text: input.text } : {}), keys } });
    }) }),
    attachToTrack: createTool({ description: "Make something follow a moving subject in a footage clip (a video with fixed framing: no camera motion, subject-follow crop or keyframes). target 'subject' uses Revline's subject tracker on the footage (runs it in the background first if needed); or give points: 2–120 {time: TIMELINE seconds, x, y: fractions 0..1 of the source frame} read from inspectFrames boxes for any other object (a license plate, a laptop, a ball). mode 'move' (default): clipId is an overlay (text, image, arrow/emoji graphic, solid, or video) whose center follows the target, plus offsetX/offsetY canvas fractions (e.g. offsetY -0.18 to sit above a head); replaces its motion. mode 'mask': clipId is the footage itself or a copy of it on a higher V layer; it gets a mask (mask.shape/width/height/feather/invert) centered on the target as it moves, e.g. duplicate the footage, setVisualEffects softBlur on the copy, then attach an ellipse mask to blur only a face or plate; or invert on a dimmed copy for a tracking spotlight. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1), footageClipId: z.string().min(1), target: z.union([z.literal('subject'), z.object({ points: z.array(z.object({ time: z.number().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(2).max(120) }).strict()]), mode: z.enum(['move', 'mask']).optional(), offsetX: z.number().min(-1).max(1).optional(), offsetY: z.number().min(-1).max(1).optional(), mask: z.object({ shape: z.enum(MASK_SHAPES), width: z.number().min(.005).max(4), height: z.number().min(.005).max(4), feather: z.number().min(0).max(200).optional(), invert: z.boolean().optional(), radius: z.number().min(0).max(.5).optional(), text: z.string().min(1).max(40).optional() }).strict().optional() }).strict(), execute: async (_ctx, input) => {
      const selected = find(editSession.timeline, input.footageClipId), source = selected.assetId ? await loadAsset(selected.assetId) : undefined;
      if (!source) throw new Error('Choose an uploaded footage clip to track.');
      if (input.target === 'subject' && !source.analysis?.focus?.length) await analyze(source._id, 'track');
      return checkpoint(t => {
        const footage = find(t, input.footageClipId), clip = find(t, input.clipId), asset = assets.find(item => item._id === footage.assetId);
        if (!asset) throw new Error('The footage media is unavailable.');
        const samples = input.target === 'subject' ? asset.analysis?.focus ?? [] : pointsToSamples(footage, input.target.points);
        if (!samples.length) throw new Error('No moving subject was detected in this footage. Give points from inspectFrames instead.');
        if ((input.mode ?? 'move') === 'mask') {
          if (!input.mask) throw new Error('Mask mode needs mask: {shape, width, height}.');
          return patchClip(t, clip.id, attachMaskPatch(clip, footage, asset, t.aspectRatio, samples, input.mask));
        }
        return patchClip(t, clip.id, attachOverlayPatch(clip, footage, asset, t.aspectRatio, samples, { x: input.offsetX ?? 0, y: input.offsetY ?? 0 }));
      });
    } }),
    setMotionBlur: createTool({ description: "Set motion blur on keyframed movement (animateClip paths on video, image, text or solid clips; camera paths keep their own blurAmount). amount 0..1 (0 off; .5 natural; 1 strong): slides and pans get directional blur along the motion, scale pops and punch-ins get radial blur, both scaled by speed so held frames stay sharp. Use for premium-feeling pop-ins, slides and whip moves. Saves immediately.", inputSchema: z.object({ clipIds: clipIdsInput, amount: z.number().min(0).max(1) }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      let next = t;
      for (const id of input.clipIds) {
        const clip = find(next, id);
        if (!clip.motion?.length) throw new Error(`Clip ${id} has no keyframed movement; animate it first with animateClip.`);
        next = patchClip(next, id, { motionBlur: input.amount > 0 ? input.amount : undefined });
      }
      return next;
    }) }),
    setVisualEffects: createTool({ description: "For an explicit effect request or authorized creative styling (AMV/hype/cinematic): adjust an uploaded video/image's requested controls with clipId, or apply the SAME patch to exact clipIds in ONE atomic save. Prefer batch clipIds for identical colors, corner rounding or effects across several sources; never send both target fields. All target validation precedes saving. Adjust these controls. Preserve all omitted controls and unrelated clips. Set enabled:true to activate a group, enabled:false to bypass it while retaining settings. Exposure is stops (-2..2), contrast/saturation 1 is neutral, temperature/tint/vibrance 0 is neutral. Blur amount/intensity are 0..1; centerX/Y are normalized. Glitch blockSize/RGB split are pixels at 1080 output height. Invert amount 1 gives negative colors, 0 is unchanged. frameCorners is the independent clip-setting Corner rounding: amount 0..1 changes the corner radius from square to fully rounded. softBlur is the clip-wide Blur setting: amount is 0..40 design pixels, 0 is clear. Combine with transform opacity for a translucent blurred background layer. Film overlay provides procedural grain, dust, scratches, vignette, flicker and warmth, each 0..1 with an overall amount; it uses no generated footage. Turbulent displace warps footage with procedural turbulence: amount 0..100 design pixels, scale 10..600 design pixels controls the noise feature size, speed 0..3 controls evolution (0 holds it still). VHS adds analog tape scanlines, noise, RGB bleed and tracking, each 0..1 with overall amount 0..1; speed 0..3 controls temporal movement and 0 freezes it. Bloom makes highlights glow: amount 0..2 (.3 subtle, .6 visible, 1.2 dreamy), threshold 0..0.95 (brightness where glow starts, .65 typical), radius 2..80 design pixels. These textures affect this uploaded video/image only, with no generated footage; disabled or amount 0 is visually neutral. Footage controls apply throughout this clip. For creative styling, use inspected action and the shared style playbook to choose restrained, purposeful effects. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1).optional(),clipIds:z.array(z.string().min(1)).min(1).max(200).refine(ids=>new Set(ids).size===ids.length,{message:'Choose unique clip IDs.'}).optional(), frameCorners:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional()}).optional(), softBlur:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(40).optional()}).optional(), bloom:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(2).optional(),threshold:z.number().min(0).max(.95).optional(),radius:z.number().min(2).max(80).optional()}).optional(), filmOverlay:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),grain:z.number().min(0).max(1).optional(),dust:z.number().min(0).max(1).optional(),scratches:z.number().min(0).max(1).optional(),vignette:z.number().min(0).max(1).optional(),flicker:z.number().min(0).max(1).optional(),warmth:z.number().min(0).max(1).optional()}).optional(), turbulentDisplace:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(100).optional(),scale:z.number().min(10).max(600).optional(),speed:z.number().min(0).max(3).optional()}).optional(), vhs:z.object({enabled:z.boolean().optional(),amount:z.number().min(0).max(1).optional(),scanlines:z.number().min(0).max(1).optional(),noise:z.number().min(0).max(1).optional(),bleed:z.number().min(0).max(1).optional(),tracking:z.number().min(0).max(1).optional(),speed:z.number().min(0).max(3).optional()}).optional(), invert: z.object({ enabled: z.boolean().optional(), amount: z.number().min(0).max(1).optional() }).optional(), colorGrade: z.object({ enabled: z.boolean().optional(), exposure: z.number().min(VISUAL_EFFECT_LIMITS.colorGrade.exposure[0]).max(VISUAL_EFFECT_LIMITS.colorGrade.exposure[1]).optional(), contrast: z.number().min(0).max(2).optional(), saturation: z.number().min(0).max(2).optional(), temperature: z.number().min(-100).max(100).optional(), tint: z.number().min(-100).max(100).optional(), vibrance: z.number().min(-100).max(100).optional() }).optional(), glitch: z.object({ enabled: z.boolean().optional(), intensity: z.number().min(0).max(1).optional(), blockSize: z.number().min(1).max(100).optional(), rgbSplit: z.number().min(0).max(50).optional() }).optional() }).strict().refine(input=>(input.clipId!==undefined)!==(input.clipIds!==undefined),{message:'Choose clipId or clipIds, never both.'}), execute: async (_ctx, { clipId,clipIds, ...changes }) => checkpoint(t => {
      let next=t;
      for(const id of clipIds??[clipId!])next=patchClip(next,id,visualEffectsPatch(find(next,id),changes));
      return next;
    }) }),
    setSpeedRamp: createTool({ description: "Speed-ramp one video or audio clip (its linked partner follows): the same source footage plays, but speed changes over the clip, and the clip's length becomes source length / average speed (it can grow, so leave room after it). Presets: montage (slow-fast-slow), hero (fast, slow-mo hit, fast), bullet (fast, near-freeze at the middle, fast), flash-in (slow then whips in), flash-out (whips then slows), ramp-in (half speed easing to normal), ramp-out (normal easing to half), slowmo-middle (normal, slow-mo through the middle, normal). Or give 2–12 anchors {x: 0..1 fraction of the clip, rate: 0.1..10, easing?} for a custom curve; segments ease-in-out by default (named easing or cubic-bézier). Align the slow part with the moment that matters (inspect it first). clear:true restores normal speed. Rendered by the playback engine in preview and export; replaces any constant setPlaybackRate speed. Saves immediately.", inputSchema: z.object({ clipId: z.string().min(1), preset: z.enum(SPEED_RAMP_PRESET_IDS as [SpeedRampPreset, ...SpeedRampPreset[]]).optional(), anchors: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(.1).max(10), easing: motionEasingInput.optional() }).strict()).min(2).max(12).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      if ([input.preset, input.anchors, input.clear || undefined].filter(value => value !== undefined).length !== 1) throw new Error('Give exactly one of preset, anchors or clear:true.');
      return setClipSpeedRamp(t, clip.id, input.clear ? null : input.preset ? presetAnchors(input.preset) : input.anchors!);
    }) }),
    analyzeColor: createTool({ description: "Read the color-grading skill first. Measure a video/image clip's real color from its source frames (not a guess from a description): exposure (median, shadows, highlights, contrast range), saturation, the light's color cast (warmth red-vs-blue, tint green-vs-magenta, from near-neutral midtones), dominant colors with names and shares, plain-language notes (e.g. warm orange cast, underexposed, clipped highlights) and a neutralizing suggestedGrade for setVisualEffects colorGrade. Optional times are timeline seconds inside the clip (1-4; default three across it). Use before color correcting, to explain a look, or to plan a grade that keeps or removes orange tungsten light.", inputSchema: z.object({ clipId: z.string().min(1), times: z.array(z.number().min(0)).min(1).max(4).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId), stats = await measureClip(clip, input.times);
      return { clipId: clip.id, measuredAt: stats.map(item => item.time), ...describeColor(stats), note: 'Measured on the source footage, before this clip\'s grade and effects.' };
    }) }),
    matchColor: createTool({ description: "Read the color-grading skill first. Shot matching: make clips look like a reference clip by measuring both (three frames each) and setting per-channel RGB curves that map each clip's tones onto the reference's (histogram matching), fixing exposure, contrast and color cast between cameras or lighting. strength 0..1 (default 1; .6-.8 keeps some of the original). Matches source footage: the reference's own grade is not included, so match first, then apply one shared grade or LUT to all. Replaces the clips' red/green/blue curves (the master curve is kept).", inputSchema: z.object({ clipIds: clipIdsInput, referenceClipId: z.string().min(1), strength: z.number().min(0).max(1).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
      await editSession.wait();
      const reference = await measureClip(find(editSession.timeline, input.referenceClipId));
      const matched: Record<string, ReturnType<typeof matchCurves>> = {};
      for (const id of input.clipIds) { if (id === input.referenceClipId) continue; matched[id] = matchCurves(await measureClip(find(editSession.timeline, id)), reference, input.strength ?? 1); }
      const saved = await checkpoint(t => { let next = t; for (const [id, curves] of Object.entries(matched)) { const clip = find(next, id); next = patchClip(next, clip.id, { colorCurves: { ...(clip.colorCurves?.master ? { master: clip.colorCurves.master } : {}), ...curves } }); } return next; });
      return { ...saved, matched: Object.keys(matched), reference: describeColor(reference).notes };
    }) }),
    setColorCurves: createTool({ description: "Read the color-grading skill first. Set RGB and master tone curves on video/image clips (after the basic grade): each curve is 2-16 [input, output] points within 0..1, interpolated smoothly without overshoot. master shapes all channels (S-curve for contrast: [[0,0],[.25,.2],[.75,.82],[1,1]]; lifted blacks for a faded film look: [[0,.08],[1,1]]); red/green/blue shift color by tone (teal shadows: blue [[0,.08],[.5,.5],[1,1]]). Omitted curves are kept; clear:true removes all curves.", inputSchema: z.object({ clipIds: clipIdsInput, master: curveInput.optional(), red: curveInput.optional(), green: curveInput.optional(), blue: curveInput.optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, { clipIds, clear, ...curves }) => checkpoint(t => {
      let next = t;
      for (const id of clipIds) { const clip = find(next, id); next = patchClip(next, clip.id, { colorCurves: clear ? undefined : { ...clip.colorCurves, ...curves } }); }
      return next;
    }) }),
    setHSL: createTool({ description: `Read the color-grading skill first. Targeted color by hue band (HSL secondary): for each of ${HSL_BANDS.join(', ')} set hue shift (-60..60 degrees), saturation (-1..1, -1 removes that color) and luminance (-1..1). Bands blend smoothly into neighbors and grays are untouched. Examples: tame orange skin or tungsten light (orange saturation -.3), richer sky (blue saturation .3, luminance -.2), teal foliage (green hue 30), isolate red (every other band saturation -1). Given bands replace those bands; clear:true removes HSL.`, inputSchema: z.object({ clipIds: clipIdsInput, bands: z.object(Object.fromEntries(HSL_BANDS.map(band => [band, z.object({ hue: z.number().min(-60).max(60).optional(), saturation: z.number().min(-1).max(1).optional(), luminance: z.number().min(-1).max(1).optional() }).strict().optional()])) as Record<typeof HSL_BANDS[number], z.ZodOptional<z.ZodObject<{ hue: z.ZodOptional<z.ZodNumber>; saturation: z.ZodOptional<z.ZodNumber>; luminance: z.ZodOptional<z.ZodNumber> }, z.core.$strict>>>).strict().optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
      if (!input.clear && !input.bands) throw new Error('Give bands, or clear:true.');
      let next = t;
      for (const id of input.clipIds) {
        const clip = find(next, id), hsl: HslAdjust = { ...clip.hsl };
        for (const [band, shift] of Object.entries(input.bands ?? {})) if (shift) hsl[band as keyof HslAdjust] = { hue: shift.hue ?? 0, saturation: shift.saturation ?? 0, luminance: shift.luminance ?? 0 };
        next = patchClip(next, clip.id, { hsl: input.clear ? undefined : hsl });
      }
      return next;
    }) }),
    applyLut: createTool({ description: `Read the color-grading skill first. Apply a 3D LUT look to video/image clips, blended by amount 0..1 (default 1; .5-.8 is often enough). Built-in looks: ${LUT_LOOKS.join(', ')}. Or pass cube: the full text of a 3D .cube LUT file (e.g. a camera log-to-Rec709 conversion or a purchased film look) with a name; it is stored once on the timeline (up to ${MAX_TIMELINE_LUTS} custom LUTs) and reused by name. Applied after grade, curves and HSL. clear:true removes the LUT.`, inputSchema: z.object({ clipIds: clipIdsInput, look: z.string().min(1).max(60).optional().describe('A built-in look, or the name of a custom LUT already stored'), cube: z.string().min(20).max(3_000_000).optional(), name: z.string().min(1).max(60).optional(), amount: z.number().min(0).max(1).optional(), clear: z.boolean().optional() }).strict(), execute: async (_ctx, input) => checkpoint(t => {
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
    addTransition: createTool({ description: `Add a transition across the cut between two touching video/image clips on the same V layer (fromClipId ends exactly where toClipId starts). Presets: ${TRANSITION_PRESETS.map(preset => `${preset} (${EFFECT_CATALOG[preset].description})`).join(' ')} duration in seconds (whip-pan .3-.5, zoom-through .4-.6, film-burn .6-1, others about .6), limited by the footage around the cut. direction applies to spin-zoom; wipeDirection to gradient-wipe and whip-pan (left/right/up/down); centerX/centerY/shape/softness to iris and gradient wipes. Returns transitionClipId.`, inputSchema: z.object({ fromClipId: z.string().min(1), toClipId: z.string().min(1), preset: z.enum(TRANSITION_PRESETS), duration: z.number().min(.1).max(3).optional(), direction: z.enum(TRANSITION_DIRECTIONS).optional(), wipeDirection: z.enum(WIPE_DIRECTIONS).optional(), softness: z.number().min(0).max(1).optional(), centerX: z.number().min(0).max(1).optional(), centerY: z.number().min(0).max(1).optional(), shape: z.enum(IRIS_SHAPES).optional() }).strict(), execute: async (_ctx, { fromClipId, toClipId, preset, ...options }) => {
      const transitionClipId = crypto.randomUUID();
      const saved = await checkpoint(t => addTransitionClip(t, transitionClipId, preset, fromClipId, toClipId, { ...options, ...(preset === 'whip-pan' && !options.wipeDirection ? { wipeDirection: 'left' as const } : {}) }));
      return { ...saved, transitionClipId };
    } }),
    freezeFrame: createTool({ description: "Freeze one video clip's picture at a timeline moment, as a still that keeps the clip's framing, crop and look. mode insert (default): the timeline grows by `duration`; everything from that moment on (all layers, markers) moves later, then the clip resumes. mode hold: the picture holds for `duration` while the clip's sound plays on, then the video resumes in sync (skipping the held footage). Classic uses: freeze on a reaction or punchline and add a caption, label or zoom on the still (it is an image clip; animateClip, setVisualEffects and text work on it). Takes a few seconds. Returns stillClipId.", inputSchema: z.object({ clipId: z.string().min(1), at: z.number().min(0).describe('Timeline seconds inside the clip'), duration: z.number().min(MIN_FREEZE_SECONDS).max(MAX_FREEZE_SECONDS), mode: z.enum(FREEZE_MODES).optional() }).strict(), execute: async (_ctx, input) => reportAnalysisFailure(async () => {
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
    smoothSlowMotion: createTool({ description: "Make slow motion smooth: AI frame interpolation (fal.ai RIFE) generates the in-between frames, so a slowed clip plays fluidly instead of stuttering. Optionally set a constant `rate` (0.25..1) in the same call; otherwise it uses the clip's current speed or speed ramp (its slowest point decides how many frames to add, up to 8x). Up to 30 seconds of footage. Runs in the background for about 1-3 minutes and costs the user's fal.ai credit; the clip switches to the smooth footage automatically after this turn's edits are saved. Use when the user asks for smooth or buttery slow-mo, or after a strong slow-down (0.5x or slower) on fast action.", inputSchema: z.object({ clipId: z.string().min(1), rate: z.number().min(.25).max(1).optional() }).strict(), execute: async (_ctx, input) => {
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
    upscaleClip: createTool({ description: "AI-upscale low-resolution footage or an image (fal.ai) so it stays sharp in a 1080p or 4K export: for small screen recordings, old clips, zoomed-in crops or low-res images. `target` is the short side in pixels (1080 default, 1440 or 2160). Video: up to 60 seconds of the clip's footage, about 2-5 minutes in the background, costs the user's fal.ai credit (quoted as estimatedUsd), and the clip switches automatically after this turn's edits are saved. Images switch the same way. Refuses media that is already at least the target size.", inputSchema: z.object({ clipId: z.string().min(1), target: z.union([z.literal(1080), z.literal(1440), z.literal(2160)]).optional() }).strict(), execute: async (_ctx, input) => {
      await editSession.wait();
      const clip = find(editSession.timeline, input.clipId), target = input.target ?? 1080;
      if ((clip.kind !== 'video' && clip.kind !== 'image') || !clip.assetId) throw new Error('Upscale a video or image clip.');
      const asset = await loadAsset(clip.assetId);
      if (asset.width && asset.height && Math.min(asset.width, asset.height) >= target) throw new Error(`This media is already ${asset.width}x${asset.height}, at least ${target}p. It needs no upscale.`);
      const started = await derive({ clipId: clip.id, assetId: clip.assetId, op: 'upscale', start: clip.kind === 'video' ? clip.sourceStart : 0, end: clip.kind === 'video' ? sourceEndOf(clip) : 0, target, fps: editSession.timeline.fps, placeLater: true });
      if (started.status === 'completed' && started.outputAssetId) { await adoptAsset(started.outputAssetId); const saved = await checkpoint(t => patchClip(t, clip.id, { assetId: started.outputAssetId! })); return { ...saved, applied: true, reusedExisting: true, estimatedUsd: 0 }; }
      return { started: true, estimatedUsd: started.estimatedUsd, note: 'Upscaling is processing; the clip switches to the sharper media automatically when it finishes.' };
    } }),
    setPlaybackRate: createTool({ description: "Change a video or audio clip’s constant playback speed from 0.25× to 4×. Preserve its retained source footage; adjust timeline duration and linked sound together. Slowing down refuses overlaps, so make room first rather than moving unrelated clips. This is constant speed, not a speed ramp.", inputSchema: z.object({ clipId: z.string(), rate: z.number().min(.25).max(4) }), execute: async (_ctx, input) => checkpoint(t => setClipPlaybackRate(t, input.clipId, input.rate)) }),
    resetVisualEffect:createTool({description:"Reset one requested footage effect group to defaults (retain its enabled state) or remove that group. Preserve every other group, clip and audio.",inputSchema:z.object({clipId:z.string(),effect:z.enum(OFFERED_VISUAL_EFFECT_GROUPS),action:z.enum(['reset','remove'])}),execute:async(_ctx,{clipId,effect,action})=>checkpoint(t=>patchClip(t,clipId,visualEffectActionPatch(find(t,clipId),effect,action)))}),
    applyTextTemplate: createTool({ description: "Apply supported Remotion text motion to a caption/graphic while preserving existing words, appearance, font, position, rotation and timing. Word reveal, Pop-in words, Sliding title, Karaoke, Neon Echo, Lyric Slam, Kinetic Stack, Chromatic split (RGB split), Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on and Echo tunnel are animations, not styled text presets. Chromatic split adds colored offsets, Outline trails adds echo trails, Cinematic focus brings words into focus, and Character scramble settles temporary display letters into the original words. Spotlight sweep moves accent light across the title; Ink write-on reveals outlines before filled lettering; Echo tunnel brings repeated outlines forward into the title. For a look use applyTextLook. Karaoke preserves saved speech-word timings when present; otherwise it uses even duration progress, not detected syllables or beat sync.", inputSchema: z.object({ clipId: z.string(), preset: z.enum(REMOTION_TEXT_PRESETS) }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); return patchClip(t, clip.id, textTemplatePatch(clip, input.preset)); }) }),
    configureTextTemplate: createTool({ description: "Change a caption/graphic Remotion template's highlight/accent color or requested animation controls, or choose a supported template. Chromatic split (rgb-split), Outline trails (type-trails), Cinematic focus (blur-focus), Character scramble, Spotlight sweep, Ink write-on and Echo tunnel support strength .2..2 (default 1), revealDuration .15..3 seconds (default .65), and stagger 0.. .18 seconds per character/word (default .07). These controls do not change clip duration, stored words or timing. Keep omitted controls, outer animation, appearance and rotation intact. Control-only edits and same-preset reselection preserve the original duration/offset clock; choosing a different preset starts its entrance on the retained clip. Colors are six-digit hex; templates and outer text animation can combine. Saves immediately.", inputSchema:z.object({clipId:z.string(),preset:z.enum(REMOTION_TEXT_PRESETS).optional(),highlightColor:z.string().regex(/^#[\da-f]{6}$/i).optional(),strength:z.number().min(.2).max(2).optional(),revealDuration:z.number().min(.15).max(3).optional(),stagger:z.number().min(0).max(.18).optional()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a text template, highlight color or animation control.'}),execute:async(_ctx,{clipId,preset,...changes})=>checkpoint(t=>{
      const clip=find(t,clipId);if(clip.kind!=='caption'&&clip.kind!=='graphic')throw new Error('Choose a caption or text graphic.');
      const patch=preset&&preset!==clip.textTemplate?.preset?textTemplatePatch(clip,preset):{},template=patch.textTemplate??clip.textTemplate;
      if(!template)throw new Error('Choose a text template before changing its appearance or animation controls.');
      return patchClip(t,clipId,{...patch,textTemplate:{...template,...changes}});
    })}),
    addTimedEffect: createTool({ description: `For explicit effects or authorized creative styling: add a supported independent FX clip (solid-color instead creates a normal V color layer): ${OFFERED_TIMED_EFFECT_PRESETS.map(preset=>EFFECT_CATALOG[preset].label).join(', ')}. One planId maps to one FX clip with the same start and full duration; plan repeated pulses separately. It affects the visual composition during its range; use explicit start or current playhead. Punch is the returning pulse in the Zoom family. It has amount1..3, speed.25..4 and centerX/centerY0..1. Optional attack/release are .01..30 seconds at1x speed; speed scales both, and if their total exceeds the FX duration both fit proportionally. Omitted timing fields preserve the legacy pulse; partial timing edits preserve every omitted control. Quick zoom in/out are one configurable Zoom family: optional zoom direction in/out, amount 1..3 times normal framing, speed 0.25..4 and centerX/centerY 0..1. Speed is progression relative to the FX range: 1 completes across the range, faster reaches the target early and holds, slower ends partway. Optional solidColor controls configure a solid-color V frame/rectangle only. Solid color follows V layer stacking; put it below footage for a background or above it for an overlay. This is independent of footage and sound timing. Footage fade in/out belongs to configureVisualFade, and sound fades to configureAudio; do not create a separate fade FX. Use addClipTransition for a real neighboring-pair transition.`, inputSchema: z.object({ planId:z.string().optional(),preset:z.enum(OFFERED_TIMED_EFFECT_PRESETS),start:z.number().min(0).optional(),duration:z.number().positive().optional(),aboveClipId:z.string().optional(),solidColor:solidColorInput.optional(),zoom:zoomInput.optional(),...pulseInputs }).strict().refine(input=>!input.zoom||isZoomPreset(input.preset),{message:'Zoom controls belong to Zoom FX.'}).refine(input=>!input.solidColor||input.preset==='solid-color',{message:'Solid color controls belong to solid-color FX.'}).refine(input=>!input.punch||input.preset==='punch',{message:'Controls must match the requested effect preset.'}), execute:async(_ctx,input)=>checkpoint(t=>{
      const start=input.start??options.playhead??0,plan=effectPlans.find(plan=>(!input.planId||plan.id===input.planId)&&plan.kind==='timed'&&plan.effect===input.preset&&Math.abs(plan.start-start)<1/t.fps);
      if(!plan&&!options.planlessEffects)throw new Error('Record this effect with planEffects before adding it.');
      if(plan&&Math.abs((input.duration??plan.duration)-plan.duration)>1/t.fps)throw new Error('Match the timed plan duration to this one FX clip. Plan each separate pulse with its own ID and range.');
      const duration=input.duration??plan?.duration;if(duration===undefined)throw new Error('Give the effect a duration in seconds.');
      const id=crypto.randomUUID();if(plan)planBindings.set(plan.id,id);
      const next=addEffectClip(t,id,input.preset,start,{duration,aboveClipId:input.aboveClipId});
      if(input.zoom)return patchClip(next,id,configureTimedEffectPatch(find(next,id),{zoom:input.zoom}));
      if(input.solidColor)return patchClip(next,id,solidColorPatch(find(next,id),input.solidColor));
      return input.punch?patchClip(next,id,configureTimedEffectPatch(find(next,id),{punch:input.punch})):next;
    })}),
    convertSolidColorToVisual:createTool({description:"Move an existing saved solid-color FX rectangle to a normal V layer so it can be placed behind or above footage. Preserve its color, size, position, opacity, timing and motion. Use only when the user wants that solid on a visual layer or behind footage. Already-normal V colors are unchanged.",inputSchema:z.object({clipId:z.string()}),execute:async(_ctx,{clipId})=>checkpoint(t=>convertSolidColorToVisual(t,clipId))}),
    setSolidColor:createTool({description:"Configure an existing solid-color V layer or saved legacy FX frame/rectangle's requested color, normalized width/height/center x/y or opacity. Width/height are fractions of output dimensions (1 fills that axis); x/y0.5 is centered. Preserve omitted controls and all footage/audio. Saves immediately.",inputSchema:solidColorInput.extend({clipId:z.string()}).refine(input=>Object.entries(input).some(([key,value])=>key!=='clipId'&&value!==undefined),{message:'Specify a solid color control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>patchClip(t,clipId,solidColorPatch(find(t,clipId),changes)))}),
    configureTimedEffect:createTool({description:"Customize a requested existing timed FX starting point: switch its supported preset or stretch duration. Punch is the returning pulse in the Zoom family. It has amount1..3, speed.25..4 and centerX/centerY0..1. Optional attack/release are .01..30 seconds at1x speed; speed scales both, and if their total exceeds the FX duration both fit proportionally. Omitted timing fields preserve the legacy pulse; partial timing edits preserve every omitted control. Zoom quick-zoom-in/out share optional zoom direction in/out, amount 1..3, speed 0.25..4, centerX/centerY 0..1; 1 completes across the FX range, faster reaches the target early and holds, slower ends partway. Preserve omitted controls, clip start and all other footage/FX/audio. Use setSolidColor for solid-color settings. Existing saved legacy fade FX can retain duration edits; new footage/audio fades use configureVisualFade/configureAudio.",inputSchema:z.object({clipId:z.string(),preset:z.enum(OFFERED_TIMED_EFFECT_PRESETS).optional(),duration:z.number().positive().optional(),...pulseInputs,zoom:zoomInput.optional()}).strict().refine(input=>input.preset!==undefined||input.duration!==undefined||input.zoom!==undefined||input.punch!==undefined,{message:'Specify a timed effect control.'}),execute:async(_ctx,{clipId,...changes})=>checkpoint(t=>patchClip(t,clipId,configureTimedEffectPatch(find(t,clipId),changes)))}),
    applyMotionPreset: createTool({ description: "Set a caption or text graphic's animation: none, fade, rise, or pop. Text animation only; use setVisualEffects for footage color, zoom blur or glitch when effects or creative styling are requested. Saves immediately.", inputSchema: z.object({ clipId: z.string(), preset: z.enum(TEXT_EFFECT_PRESETS) }), execute: async (_ctx, input) => checkpoint(t => {
      const clip = find(t, input.clipId);
      return patchClip(t, clip.id, textEffectPatch(clip, input.preset));
    }) }),
    animateClip: createTool({ description: "Animate one object, or batch distinct objects with objects:[{clipId,keyframes,replaceMotion?}] in one atomic edit. For scattered words aligning into a line, inspect their static placement, use individual final canvas offsets and matching absolute timeline arrival times (convert to each clip-local time). Include a baseline/hold before the alignment starts, retain every word as a separate editable object, and do not change unselected clips. Animate a VIDEO clip, CAPTION, TEXT GRAPHIC, UPLOADED IMAGE overlay or SOLID-COLOR object as a whole (move, scale, rotate, fade, brighten it on the canvas, e.g. a picture-in-picture video sliding in). This is object motion in canvas coordinates, not a camera or automatic attachment to another clip. keyframes use CLIP-LOCAL timeline seconds within its duration. x/y are offsets as fractions of canvas width/height relative to the object's static placement, not original-source target coordinates. For video and image clips the tool maps those canvas offsets through inverse static scale/rotation so small or rotated overlays still move the requested canvas distance; scale/opacity multiply current values, rotation uses degrees, brightness1 is unchanged. Keep the static base layout and sources. Optional destination-anchor easing: linear, ease-in-out, ease-out, focused-spring, or a custom cubic-bézier curve [x1,y1,x2,y2] (x1/x2 in 0..1; y above 1 overshoots, e.g. [0.34,1.56,0.64,1] for a springy pop, [0.7,0,0.84,0] for a slow-start ease-in). Eased paths accept2–8 anchors, batch the entire path in one call; without non-linear easing, existing linear paths accept0–120 points. First/last states hold outside the provided anchors; add an explicit0-second baseline point when motion must begin later. Replaces only this object's custom motion. A prior image camera/smoothZoom recipe requires explicit user replacement permission and replaceMotion:true; otherwise use configureCameraMotion to edit that camera path. To push or pan INSIDE footage (camera reframing) use configureSmoothZoom/configureCameraMotion instead; animateClip moves the whole video frame. Coordinate any chosen image/text/solid's timing with a footage camera path only when requested, by planning both paths in their respective coordinate spaces. Do not claim parenting, automatic scene attachment or automatic continuous cursor tracking. Text motion replaces basic text animation but preserves its styling and existing text-template settings. Add setMotionBlur afterwards for premium-feeling fast moves.", inputSchema:objectMotionInput.partial().extend({objects:z.array(objectMotionInput).min(1).max(32).optional()}).strict().refine(input=>input.objects!==undefined?input.clipId===undefined&&input.keyframes===undefined&&input.replaceMotion===undefined:input.clipId!==undefined&&input.keyframes!==undefined,{message:'Send one clipId with keyframes, or an objects batch, not both.'}), execute:async(_ctx,input)=>checkpoint(t=>animateObjects(t,input.objects??[{clipId:input.clipId!,keyframes:input.keyframes!,replaceMotion:input.replaceMotion}])) }),
    cropClip: createTool({ description: "Set requested crop edge amounts on a video/image. units defaults normalized source-axis fractions; units pixels uses recorded intrinsic asset width for left/right and height for top/bottom. Require known positive source dimensions for pixels; never invent source geometry. Opposing edges must leave more than 5% per axis. Preserve omitted edges, source placement/fitted size, transform, fit, volume and timing; crop masks without zooming the source.", inputSchema: z.object({ clipId: z.string(),units:z.enum(VISUAL_INPUT_UNITS).optional(), top: z.number().min(0).optional(), right: z.number().min(0).optional(), bottom: z.number().min(0).optional(), left: z.number().min(0).optional() }), execute: async (_ctx, input) => checkpoint(t => {
      const {clipId,units,...changes}=input;const clip=find(t,clipId),asset=assets.find(asset=>asset._id===clip.assetId);
      return patchClip(t,clipId,cropInputPatch(clip,changes,asset??{},units));
    }) }),
    applyLayout:createTool({description:"Apply the Two rows composition preset to exact existing video/image clips: supporting clips in topClipIds, explanation/narrator in bottomClipIds. Each row fills half the current canvas without stretching the source. Preserve source ranges, timing, sound, effects and all unselected clips. This only sets framing; arrange overlapping row footage on separate V layers with explicit timeline tools when needed. Existing custom object motion/legacy follow crop must be resolved explicitly first; do not silently remove it.",inputSchema:z.object({layout:z.literal('two-rows'),topClipIds:z.array(z.string().min(1)).max(100),bottomClipIds:z.array(z.string().min(1)).max(100)}).refine(input=>input.topClipIds.length+input.bottomClipIds.length>0,{message:'Choose footage for at least one row.'}),execute:async(_ctx,{topClipIds,bottomClipIds})=>checkpoint(t=>applyTwoRowLayout(t,assets,{topClipIds,bottomClipIds}))}),
    fitClip: createTool({ description: "Fit a video/image into its frame (contain, preserving the complete source) or fill the frame (cover, cropping overflow); save immediately.", inputSchema: z.object({ clipId: z.string(), fit: z.enum(["cover", "contain"]) }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (clip.kind !== "video" && clip.kind !== "image") throw new Error("Choose a video or image"); return patchClip(t, clip.id, { fit: input.fit }); }) }),
    resetVisual: createTool({ description: "Reset a video/image's position, scale, rotation, opacity, and edge crop to defaults; save immediately.", inputSchema: z.object({ clipId: z.string() }), execute: async (_ctx, input) => checkpoint(t => { const clip = find(t, input.clipId); if (clip.kind !== "video" && clip.kind !== "image") throw new Error("Choose a video or image"); return patchClip(t, clip.id, { transform: undefined, crop: undefined, fit: undefined }); }) }),
    setAspectRatio: createTool({ description: "Set the canvas aspect ratio; save immediately.", inputSchema: z.object({ aspectRatio: z.enum(["vertical", "square", "landscape", "portrait-feed", "classic"]) }), execute: async (_ctx, input) => checkpoint(t => ({ ...t, aspectRatio: input.aspectRatio })) }),
    followSubject: createTool({ description: "Enable subject-follow crop on a video clip, requesting real background tracking when absent. Set enabled:false to turn off existing follow crop immediately without any analysis. Preserve source/timing and other crop/transform controls.", inputSchema: z.object({ clipId: z.string(),enabled:z.boolean().optional() }), execute: async (_ctx, input) => {
      if(input.enabled===false)return checkpoint(t=>{const clip=find(t,input.clipId);if(clip.kind!=='video')throw new Error('Choose a video clip.');return patchClip(t,clip.id,{focus:undefined})});
      const selected = find(editSession.timeline, input.clipId); const source = selected.assetId?await loadAsset(selected.assetId):undefined;
      if (selected.kind !== "video" || !source) throw new Error("Choose an uploaded video clip");
      if (!source.analysis?.focus?.length) await analyze(source._id, "track");
      return checkpoint(t => { const clip = find(t, input.clipId); const asset = assets.find(current => current._id === clip.assetId); if (clip.kind !== "video" || !asset?.analysis?.focus?.length) throw new Error("No visible subject was detected in this video"); return patchClip(t, input.clipId, { focus: focusForClip(asset.analysis.focus, clip) }); });
    } }),
    removeBackground: createTool({ description: "Ultra only. Remove the background behind the person in one existing video clip so visuals on a LOWER V layer show behind them (fal.ai cut-out). With `subject` (a short noun such as \"phone\" or \"coffee cup\"), keep only that object instead of the person (SAM 3 mask, harder edges; about $0.01 per second). Use only when the user asks to remove or replace their background, put visuals behind them, or isolate an object. It runs in the background for about 1-3 minutes and costs the user's fal.ai credit (about $0.02 per second of the clip for a person); the clip switches to the transparent cut-out automatically, after this turn's edits are saved. Place the replacement visuals on a lower V layer under the clip.", inputSchema: z.object({ clipId: z.string().min(1), subject: z.string().min(1).max(60).optional().describe('Object to keep instead of the person, e.g. "phone". Omit to keep the person.') }), execute: async (_ctx, { clipId, subject }) => {
      const result = await ctx.runMutation(internal.cutouts.startFromRun, { ...run, clipId, ...(subject ? { subject } : {}) });
      return result.reused ? { applied: true, reusedExistingCutOut: true, estimatedUsd: 0, note: 'An existing cut-out of this footage was applied; the background is already removed. Visuals belong on a lower V layer.' } : { started: !result.alreadyRunning, alreadyRunning: result.alreadyRunning, estimatedUsd: result.estimatedUsd, note: 'Background removal is processing; the clip switches to the cut-out automatically when it finishes. Visuals belong on a lower V layer.' };
    } }),
  };
  return { tools, editSession, plans: () => effectPlans };
}
