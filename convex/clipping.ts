import { ConvexError, v } from "convex/values";
import { isMcpRun, isMcpTaskId } from "./lib/run_ids";
import { runArgs } from "./lib/active_run";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireProject } from "./lib/auth";
import { hydrateAsset } from "./lib/asset_analysis";
import {
  activeTabOf,
  storedTabTimeline,
  tabsOf,
  MAX_TIMELINE_TABS,
  removeTabFor,
} from "./timelineTabs";
import {
  clipCheckResult,
  checkClipData,
  retainedFootage,
  timelineFingerprint,
  
} from "../lib/media-analysis/clip-check";
import {
  defaultClipCount,
  HIGHLIGHT_QUALITY_BAR,
  rankHighlights,
  readHighlights,
  semanticMoment,
  transcriptHighlightTracks,
  type SemanticMoment,
  type SourceType,
  loudnessOnsets,
} from "../lib/media-analysis/highlights";
import {
  clippingChoice,
  clipSourceType,
  qualityCheck,
  fallbackMoment,
  clipCheckRequestValidator,
} from "./lib/clipping_validator";
import { timelineDuration, type Timeline } from "../lib/editor/types";
import { timelineValidator } from "./schema";
import { clipQuoteProblems, clipChoiceProblems } from '../lib/media-analysis/clip-plan-feedback';

const runKey = (runId: string) =>
  isMcpTaskId(runId)
    ? runId
    : isMcpRun(runId)
      ? "mcp-clipping"
      : runId;
const rowFor = (
  ctx: QueryCtx | MutationCtx,
  args: { projectId: Doc<"projects">["_id"]; runId: string },
) =>
  ctx.db
    .query("clippingRuns")
    .withIndex("by_project_run", (q) =>
      q.eq("projectId", args.projectId).eq("runId", runKey(args.runId)),
    )
    .unique();
type Candidate = ReturnType<typeof rankHighlights>[number];
const targetCount = (row: Doc<"clippingRuns">, duration: number) => Math.min(row.requestedCount??Math.min(10,Math.max(3,Math.round(duration/150))),Math.max(0,MAX_TIMELINE_TABS-row.baseline.length));
const checksFor = (row: Doc<'clippingRuns'>, timelineId: string) =>
  row.qualityTimelineIds && !row.qualityTimelineIds.includes(timelineId) ? [] : row.qualityChecks ?? [];
const candidatesOf = (row: Doc<"clippingRuns">): Candidate[] =>
  JSON.parse(row.candidates);
// One bounded targeted-video budget per batch, shared by reserveVisual and found.
const VISUAL_WINDOWS = 12,
  VISUAL_SECONDS = 600,
  INSPECTION_TIMEOUT_MS = 240_000;
const visualBudgetFits = (row: Doc<"clippingRuns">, duration: number, seconds: number) => {
  const windows = row.visualWindows ?? [];
  return windows.length < VISUAL_WINDOWS &&
    windows.reduce((n, w) => n + w.end - w.start, 0) + seconds <= Math.min(VISUAL_SECONDS, duration);
};
/** findHighlights proposes no moments; saved words, pauses and cuts only refine found ones. */
function discoveryTracks(
  asset: Doc<"assets">,
  type: SourceType | undefined,
  transcriptOnly: boolean,
) {
  const saved = readHighlights(asset.analysis?.highlights);
  const tracks = transcriptHighlightTracks(
    asset.duration ?? 0,
    asset.analysis?.transcript,
    type ?? saved?.sourceType,
    transcriptOnly,
  );
  // Out points snap to the same measured pauses that finish checks against.
  if (saved) {
    tracks.signals = saved.signals;
    tracks.sceneCuts = saved.sceneCuts;
    tracks.levels = saved.levels;
    tracks.levelStep = saved.levelStep;
    tracks.coverage = { ...tracks.coverage, audioSeconds: saved.coverage.audioSeconds };
  }
  const shots = asset.analysis?.shots?.shots.map((s) => s.start);
  if (shots?.length) tracks.sceneCuts = shots;
  if (!transcriptOnly) {
    const declared = type ?? saved?.sourceType;
    tracks.typeReason = `${declared ? `Visual discovery for ${declared} footage` : "Visual discovery"}: pick moments from audio peaks, scene cuts${tracks.coverage.transcriptWords ? " and the saved transcript" : ""}, confirmed with targeted inspectVideo windows.`;
  }
  return tracks;
}
/** Relative spikes first; a uniformly loud source falls back to loudness onsets. */
function peaksOf(tracks: ReturnType<typeof discoveryTracks>) {
  const spikes = tracks.signals.filter((s) => s.kind === "spike").sort((a, b) => b.strength - a.strength);
  return (spikes.length ? spikes : loudnessOnsets(tracks.levels, tracks.levelStep, tracks.duration)).slice(0, 60);
}
// A quote needs a letter or digit; "..." or "—" is not spoken evidence.
const spoken = (text: string) => /[\p{L}\p{N}]/u.test(text);
/** Quoted words ground spoken parts; every other part needs a video observation. */
const visualParts = (m: SemanticMoment) => [
  ...(m.kind === "action" || !spoken(m.payoff.text) ? [m.payoff] : []),
  ...(!spoken(m.hook.text) ? [m.hook] : []),
];
async function tabContents(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
  draft?: Timeline,
  timelineId = activeTabOf(project),
) {
  return Promise.all(
    tabsOf(project).map(async (tab) => ({
      id: tab.id,
      name: tab.name,
      timeline:
        draft && tab.id === timelineId
          ? draft
          : (await storedTabTimeline(ctx, project, tab.id))!,
    })),
  );
}

export const begin = internalMutation({
  args: {
    ...runArgs,
    assetId: v.id("assets"),
    delivery: v.boolean(),
    sourceType: v.optional(clipSourceType),
    count: v.optional(v.number()),
    transcriptOnly: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      raw = await ctx.db.get(args.assetId);
    if (
      !raw ||
      raw.ownerId !== args.ownerId ||
      raw.projectId !== args.projectId
    )
      throw new ConvexError("Choose a source from this project.");
    const asset = await hydrateAsset(ctx, raw);
    const transcriptOnly = !!args.transcriptOnly;
    const previous = await rowFor(ctx, args);
    if (previous && (previous.reviewMode === 'transcript') !== transcriptOnly)
      throw new ConvexError('Keep the existing batch review mode; start a new request to change it.');
    // Continuing a run never erases its accepted list or its original baseline.
    if (previous && previous.assetId !== asset._id)
      throw new ConvexError(
        "Finish this source batch before starting another in the same run.",
      );
    // A reviewed plan keeps its type; otherwise the latest declared type applies.
    const tracks = discoveryTracks(asset, previous?.reviewed ? previous.sourceType : args.sourceType ?? previous?.sourceType, transcriptOnly);
    // Discovery proposes no moments of its own: candidates come only from planClips
    // found and survive a repeated findHighlights (e.g. to request delivery). The
    // source type is only their label, so relabeling equals re-ranking.
    const candidates = (previous ? candidatesOf(previous) : []).map((c) => ({ ...c, sourceType: tracks.sourceType }));
    const qualified = candidates.filter((c) => c.qualified).length;
    const slots = Math.max(0, MAX_TIMELINE_TABS - tabsOf(project).length);
    // Before found this is the source-length suggestion; afterwards at most the qualified moments.
    const recommendedCount = candidates.length
      ? Math.min(args.count ?? previous?.requestedCount ?? defaultClipCount(tracks.duration, qualified), qualified, slots)
      : Math.min(args.count ?? Math.min(10, Math.max(3, Math.round(tracks.duration / 150))), 10, slots);
    if (!previous) {
      const tabs = await tabContents(ctx, project);
      await ctx.db.insert("clippingRuns", {
        ownerId: args.ownerId,
        projectId: args.projectId,
        runId: runKey(args.runId),
        assetId: asset._id,
        createdAt: Date.now(),
        delivery: args.delivery,
        targeted: true,
        reviewMode: transcriptOnly ? "transcript" : "visual",
        ...(args.sourceType ? { sourceType: args.sourceType } : {}),
        ...(tracks.unavailableReason
          ? { unavailableReason: tracks.unavailableReason }
          : {}),
        candidates: JSON.stringify(candidates),
        recommendedCount,
        ...(args.count ? { requestedCount: args.count } : {}),
        reviewed: false,
        accepted: [],
        dropped: [],
        baseline: tabs.map((t) => ({
          id: t.id,
          fingerprint: timelineFingerprint(t.timeline),
        })),
        receipts: [],
      });
    } else if (!previous.reviewed)
      await ctx.db.patch(previous._id, {
        delivery: previous.delivery || args.delivery,
        candidates: JSON.stringify(candidates),
        recommendedCount,
        ...(args.count ? { requestedCount: args.count } : {}),
        ...(args.sourceType ? { sourceType: args.sourceType } : {}),
        ...(tracks.unavailableReason
          ? { unavailableReason: tracks.unavailableReason }
          : {}),
      });
    else if (args.delivery && !previous.delivery)
      await ctx.db.patch(previous._id, { delivery: true });
    return {
      assetId: asset._id,
      sourceType: tracks.sourceType,
      typeReason: tracks.typeReason,
      found: candidates.length,
      ...(candidates.length
        ? { registeredCandidates: "Kept the candidates already registered with planClips found; accept/drop these IDs, or send found again with the complete replacement set." }
        : {}),
      qualified,
      recommendedCount: previous?.reviewed
        ? previous.recommendedCount
        : recommendedCount,
      qualityBar: HIGHLIGHT_QUALITY_BAR,
      candidates: candidates.slice(0, Math.max(10, recommendedCount)),
      coverage: tracks.coverage,
      warnings: tracks.warnings,
      analysisMs: tracks.elapsedMs,
      cacheVersion: tracks.version,
      reviewMode: transcriptOnly ? 'transcript' : 'visual',
      aspectRatio: asset.width === asset.height ? 'square' : (asset.width ?? 16) > (asset.height ?? 9) ? 'landscape' : 'vertical',
      discoveryMode: transcriptOnly ? 'transcript' : 'targeted-visual',
      ...(tracks.judge === "fallback"
        ? {
            geminiUnavailableReason: tracks.unavailableReason,
            transcript: asset.analysis?.transcript?.segments ?? [],
            peaks: peaksOf(tracks),
            sceneCuts:
              asset.analysis?.shots?.shots.map((s) => s.start) ??
              tracks.sceneCuts,
            next: transcriptOnly ? "Select distinct hooks/payoffs from this transcript, then register planClips found. Use inspectAssetAnalysis only for exact boundary word windows; do not reread the full source. Preserve source framing/aspect, skip normalization unless requested, finishClipping and finish validate data inline without checkClip. No source frames, Gemini, speaker tracking or rendered verification is required." : "Propose candidates from the transcript and existing audio/shot helpers. Spoken moments are grounded by exact hook/payoff quotes and need no video. For action or non-verbal hook/payoff moments, inspectVideo with explicit SOURCE start/end (up to 60s) and a focused question; extend only uncertain candidates. If Gemini is unavailable, register the spoken moments; unobserved visual ones come back unresolved. For silent footage, inspect a bounded sparse set of short video windows, then refine observed events; report inspected coverage. Stills/cuts alone cannot prove action. Register grounded planClips found moments. The server returns candidate IDs; accept/drop those IDs in the next planClips call. Never stop at suggestions when clips were requested.",
          }
        : {}),
      note: "Review top 8-10. Call planClips with current accepted IDs and named tabs; give reasons for rejected reviewed candidates. Build accepted tabs, then finishClipping and finish directly; checkClip is optional. Never pad to the count.",
    };
  },
});

export const review = internalMutation({
  args: {
    ...runArgs,
    found: v.optional(v.array(fallbackMoment)),
    shortfallReason:v.optional(v.string()),
    accepted: v.optional(v.array(clippingChoice)),
    editorRunId: v.optional(v.string()),
    dropped: v.optional(
      v.array(v.object({ candidateId: v.string(), reason: v.string() })),
    ),
  },
  returns: v.any(),
  handler: async (ctx, input) => {
    const args = {
      ...input,
      accepted: input.accepted ?? [],
      dropped: input.dropped ?? [],
    };
    const project = await requireProject(ctx, args.projectId, args.ownerId);
    const row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId)
      throw new ConvexError("planClips registers moments Revline found: call findHighlights first when the request asks Revline to choose them. For cuts at source ranges you were given, skip both: build the tabs and call finish.");
    if (args.found) {
      if (!row.unavailableReason && !row.targeted && row.reviewMode !== "transcript")
        throw new ConvexError(
          "Agent-found moments are only used after Gemini is unavailable.",
        );
      if (row.reviewed)
        throw new ConvexError(
          "Keep the existing reviewed plan; revise accepted/dropped choices instead of resetting found moments.",
        );
      if (!args.found.length || args.found.length > 30)
        throw new ConvexError(
          "Register 1-30 distinct reviewed fallback moments.",
        );
      const raw = await ctx.db.get(row.assetId);
      if (!raw) throw new ConvexError("The source was removed.");
      const source = await hydrateAsset(ctx, raw),
        tracks = row.targeted || row.reviewMode === 'transcript' ? discoveryTracks(source, row.sourceType, row.reviewMode === 'transcript') : readHighlights(source.analysis?.highlights);
      if (!tracks) throw new ConvexError("Source helper analysis is missing.");
      const moments = args.found.map((raw) => {
        const m = semanticMoment.parse(raw);
        if (row.reviewMode === 'transcript' && (m.kind === 'action' || !spoken(m.hook.text) || !spoken(m.payoff.text)))
          throw new ConvexError('Transcript-first moments need spoken hook and payoff quotes; visual action uses the visual path.');
        if (
          m.start < 0 ||
          m.end > (source.duration ?? 0) ||
          m.end <= m.start ||
          m.hook.start < m.start ||
          m.hook.end > m.end ||
          m.hook.end < m.hook.start ||
          m.payoff.start < m.hook.start ||
          m.payoff.end > m.end ||
          m.payoff.end < m.payoff.start ||
          m.reactionEnd < m.payoff.end ||
          m.reactionEnd > m.end ||
          m.reason.trim().length < 20
        )
          throw new ConvexError(
            "Fallback moments need an intact hook/payoff/reaction and concrete source evidence.",
          );
        return m;
      });
      const quoteErrors = moments.flatMap((moment, index) => clipQuoteProblems(moment, source.analysis?.transcript?.words ?? [])
        .map(problem => ({ index, title: moment.title, ...problem })));
      if (quoteErrors.length) return { success: false, saved: false, errors: quoteErrors,
        next: 'Correct every listed hook/payoff using the saved word timings. Retry found with the complete candidate set; nothing was replaced. For truncated windows, read only that source window with inspectAssetAnalysis.' };
      // Quotes now ground every spoken hook/payoff. Action and non-verbal parts
      // need a saved targeted video observation; stills, cuts and commentary never do.
      type Observation = { available?: boolean; code?: string; reason?: string; matches?: { start: number; end: number }[] };
      const targetedVisual = !!row.targeted && row.reviewMode === 'visual';
      const windows = targetedVisual
        ? (row.visualWindows ?? []).map(w => ({ ...w, observation: w.result ? JSON.parse(w.result) as Observation : undefined })) : [];
      // Gemini is down now if the batch's latest inspection or this run's provider latch says so;
      // a later successful inspection (or a new run) lifts it.
      const latest = windows.filter(w => w.observation).at(-1)?.observation;
      const unavailable = row.unavailableReason
        ?? (latest?.available === false && latest.code === 'VIDEO_ANALYSIS_UNAVAILABLE' ? latest.reason : undefined)
        ?? (args.editorRunId && project.aiAnalysisUsage?.runId === args.editorRunId ? project.aiAnalysisUsage.videoUnavailable : undefined);
      const now = Date.now();
      // An inspected part that shows nothing must go; one that cannot be inspected
      // (outage, interrupted inspection, spent budget) stays out as unresolved.
      const problems = targetedVisual
        ? moments.flatMap((moment, index) => {
            const parts = visualParts(moment).flatMap(part => {
              if (windows.some(w => w.observation?.matches?.some(match => match.start <= part.end && match.end >= part.start))) return [];
              const covering = windows.filter(w => w.start <= part.start && w.end >= part.end);
              const at = { start: part.start, end: part.end };
              if (covering.some(w => Array.isArray(w.observation?.matches)))
                return [{ ...at, message: 'The saved inspectVideo observation of this window does not show it; remove this moment.' }];
              const reason = unavailable ? `Video inspection was unavailable: ${unavailable.split(/(?<=\.)\s/)[0].slice(0, 200)}`
                : covering.some(w => !w.result && now - w.createdAt > INSPECTION_TIMEOUT_MS) ? 'Its targeted video inspection was interrupted.'
                : !visualBudgetFits(row, tracks.duration, Math.max(1, part.end - part.start)) ? 'The batch visual-inspection budget was spent.'
                : undefined;
              return [reason ? { ...at, reason } : { ...at, message: 'No saved inspectVideo observation covers this action or non-verbal part.' }];
            });
            const part = parts.find(p => 'message' in p) ?? parts[0];
            return part ? [{ index, title: moment.title, ...part }] : [];
          })
        : [];
      const errors = problems.filter(p => 'message' in p);
      if (errors.length) return { success: false, saved: false, errors,
        next: 'inspectVideo each listed SOURCE window (at most 60s, focused question), or remove moments an observation does not show, then retry found with the complete set. Spoken moments with matching hook/payoff quotes need no video. Nothing was replaced.' };
      const unresolved = problems.flatMap(p => 'reason' in p && p.reason ? [{ title: p.title, start: p.start, end: p.end, reason: p.reason }] : []);
      const grounded = moments.filter((_, index) => !problems.some(p => p.index === index));
      if (!grounded.length) return { success: false, saved: false, unresolved,
        ...(unavailable ? { geminiUnavailableReason: unavailable } : {}),
        next: 'No spoken or video-observed moment remains, and stills, cuts or commentary cannot prove action. Register transcript-grounded spoken moments, or stop and tell the user no moment could be grounded, naming these unresolved visual moments; finishClipping cannot pass with zero clips. Nothing was replaced.' };
      const candidates = rankHighlights(
        { ...tracks, judge: "fallback", moments: grounded },
        source.analysis?.transcript,
      );
      const qualified = candidates.filter((c) => c.qualified).length;
      const recommendedCount = Math.min(
        row.requestedCount ?? defaultClipCount(tracks.duration, qualified),
        qualified,
        Math.max(0, MAX_TIMELINE_TABS - tabsOf(project).length),
      );
      await ctx.db.patch(row._id, {
        candidates: JSON.stringify(candidates),
        recommendedCount,
        // Replaced with the candidate set; finish lists them in the final message.
        unresolved: unresolved.length ? unresolved : undefined,
      });
      return {
        planSaved: true,
        stage: 'found',
        found: candidates.length,
        qualified,
        recommendedCount,
        sourceLengthTarget:targetCount(row,tracks.duration),
        candidates: candidates.slice(0, 10),
        geminiUnavailableReason: unavailable,
        ...(unresolved.length ? { unresolved } : {}),
        next: "This found call replaced the candidate set. Use only these returned IDs and suggested start/end ranges; another found call must include the complete replacement set. Accept or drop each reviewed ID with planClips, then build the accepted tabs and call finishClipping and finish directly. Heavy QA is optional. A requested montage or trailer short is one tab cutting several ranges of one moment to 15-60 s: build it first, then accept its retained source span (first in to last out) bound by timelineId; its hook and payoff must sit in retained footage." +
          (unresolved.length ? " Unresolved visual moments were left out for lack of a video observation; the final message lists them. Never present them as clips." : ""),
      };
    }
    const candidates = candidatesOf(row),
      ids = new Set<string>();
    if (args.accepted.length > 10)
      throw new ConvexError("Accept at most 10 clips per batch.");
    if (
      new Set(args.accepted.map((c) => c.name.trim())).size !==
      args.accepted.length
    )
      throw new ConvexError(
        "Each accepted clip needs its own distinct tab name.",
      );
    // A choice bound to a built tab is judged by what that tab keeps: its timeline
    // duration and, for a montage, the retained source span instead of one window.
    const tabs = tabsOf(project);
    const footageOf = new Map(
      (await Promise.all(args.accepted.map(async (choice) => {
        const tab = tabs.find((t) =>
          choice.timelineId ? t.id === choice.timelineId : t.name === choice.name,
        );
        const timeline = tab && (await storedTabTimeline(ctx, project, tab.id));
        return timeline ? [[choice.candidateId, retainedFootage(timeline, String(row.assetId))] as const] : [];
      }))).flat(),
    );
    const choiceErrors = args.accepted.flatMap(choice => {
      const candidate = candidates.find((c) => c.id === choice.candidateId);
      const footage = footageOf.get(choice.candidateId);
      const errors = clipChoiceProblems(choice, candidate, footage);
      if (ids.has(choice.candidateId)) errors.push('Accept each candidate ID only once.');
      ids.add(choice.candidateId);
      return errors.length ? [{ candidateId: choice.candidateId, errors,
        ...(candidate ? { suggestedRange: { start: candidate.start, end: candidate.end } } : {}),
        ...(footage?.ranges.length ? { tab: { duration: footage.duration, retainedSourceRanges: footage.ranges } } : {}) }] : [];
    });
    if (choiceErrors.length) return { success: false, saved: false, errors: choiceErrors,
      candidates: candidates.slice(0, 10).map(({ id, start, end, qualified }) => ({ id, start, end, qualified })),
      next: 'Correct every listed choice and retry the complete accepted/dropped plan. Use the current candidate IDs and suggested ranges; the saved plan has not changed.' };
    for (const drop of args.dropped) {
      if (
        !candidates.some((c) => c.id === drop.candidateId) ||
        ids.has(drop.candidateId) ||
        drop.reason.trim().length < 8 ||
        drop.reason.length > 500
      )
        throw new ConvexError(
          "A dropped candidate needs its own ID and a concrete review reason.",
        );
      ids.add(drop.candidateId);
    }
    // Every reviewed top candidate is accounted for; lower ranks may remain for a
    // later batch. A justified rejection can legitimately reduce the count.
    const reviewed = candidates.slice(0, Math.min(10, candidates.length));
    const missing = reviewed.filter((c) => !ids.has(c.id));
    if (missing.length)
      throw new ConvexError(
        `Accept or give a reason for each reviewed top candidate: ${missing.map((c) => c.id).join(", ")}.`,
      );
    const previouslyAccepted = row.accepted.filter(
      (c) => !args.accepted.some((a) => a.candidateId === c.candidateId),
    );
    if (
      previouslyAccepted.some(
        (c) => !args.dropped.some((d) => d.candidateId === c.candidateId),
      )
    )
      throw new ConvexError(
        "Record why each previously accepted candidate was dropped.",
      );
    const source=await ctx.db.get(row.assetId),target=targetCount(row,source?.duration??0),shortfallReason=input.shortfallReason?.trim()??row.shortfallReason;
    if(args.accepted.length<target&&!args.dropped.length&&(!shortfallReason||shortfallReason.length<20))throw new ConvexError(`Accepted ${args.accepted.length}, source-length target ${target}. Provide shortfallReason with the concrete quality/context/boundary reason fewer qualified; never pad weak moments.`);
    if(shortfallReason&&shortfallReason.length>500)throw new ConvexError("Keep shortfallReason under 500 characters.");
    const discardedTabs: string[] = [];
    for (const choice of previouslyAccepted) {
      const tab = tabsOf(project).find((t) =>
        choice.timelineId ? t.id === choice.timelineId : t.name === choice.name,
      );
      if (!tab || row.baseline.some((b) => b.id === tab.id)) continue;
      if (tab.id === activeTabOf(project))
        throw new ConvexError(
          "Open a retained or original tab before dropping its built clip; planClips then removes only that new abandoned tab.",
        );
      const timeline = await storedTabTimeline(ctx, project, tab.id);
      if (timeline?.clips.some((c) => c.approval || c.approvedSections?.length))
        throw new ConvexError(
          "The dropped tab contains user-approved work. Keep it or ask the user before removing it.",
        );
      if (!args.editorRunId)
        throw new ConvexError(
          "Dropping a built tab requires its active editor run context.",
        );
      await removeTabFor(
        ctx,
        args.ownerId,
        { projectId: args.projectId, timelineId: tab.id },
        args.editorRunId,
      );
      discardedTabs.push(tab.id);
    }
    await ctx.db.patch(row._id, {
      reviewed: true,
      // Accepting a delivery plan promotes discovery-only inspection; otherwise
      // completion could report zero tabs even after building the accepted cuts.
      delivery: true,
      ...(shortfallReason?{shortfallReason}:{}),
      accepted: args.accepted,
      dropped: args.dropped,
      receipts: row.receipts.filter((receipt) => {
        const old = row.accepted.find(
          (c) =>
            c.timelineId === receipt.timelineId ||
            (!c.timelineId &&
              tabsOf(project).some(
                (t) => t.id === receipt.timelineId && t.name === c.name,
              )),
        );
        const next =
          old && args.accepted.find((c) => c.candidateId === old.candidateId);
        const regionKey = (c: (typeof row.accepted)[number]) =>
          JSON.stringify(
            (c.criticalRegions ?? []).map((r) => [r.x, r.y, r.w, r.h]),
          );
        return (
          old &&
          next &&
          old.start === next.start &&
          old.end === next.end &&
          (!next.timelineId || next.timelineId === receipt.timelineId) &&
          regionKey(old) === regionKey(next)
        );
      }),
    });
    return {
      planSaved: true,
      stage: 'accepted',
      ...(row.unavailableReason
        ? { geminiUnavailableReason: row.unavailableReason }
        : {}),
      reviewMode: row.reviewMode ?? "visual",
      found: candidates.length,
      qualified: candidates.filter((c) => c.qualified).length,
      recommended: row.recommendedCount,
      discardedTabs,
      accepted: args.accepted,
      dropped: args.dropped,
      ...(args.accepted.length ? {} : { warning: "No candidate accepted: finishClipping cannot pass with zero clips. Accept a qualified candidate, or stop and tell the user no moment qualified." }),
      next: "Build exactly these populated tabs, preserving source framing unless reframing was requested. Bind their timelineIds by calling planClips again, or use the exact unique tab names. Build the tabs, then finishClipping and finish directly. Cheap data checks run inline; no normalization or heavy check is required.",
    };
  },
});

export const prepareCheck = internalQuery({
  args: {
    ...runArgs,
    timelineId: v.string(),
    acceptedFindings: v.optional(
      clipCheckRequestValidator.fields.acceptedFindings,
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId || !row.reviewed)
      throw new ConvexError("Record the accepted clip plan before checkClip.");
    const tab = tabsOf(project).find((t) => t.id === args.timelineId),
      choice = row.accepted.find(
        (c) =>
          c.timelineId === args.timelineId ||
          (!c.timelineId && c.name === tab?.name),
      ),
      candidate =
        choice && candidatesOf(row).find((c) => c.id === choice.candidateId);
    if (!choice || !candidate)
      throw new ConvexError(
        "This tab does not match an accepted candidate. Fix planClips or the tab name.",
      );
    const raw = await ctx.db.get(row.assetId);
    if (!raw) throw new ConvexError("The accepted source was removed.");
    const reactionEnd = candidate.reactionEnd;
    const timeline = await storedTabTimeline(ctx, project, args.timelineId);
    const cached = timeline && row.receipts.find(r => r.timelineId === args.timelineId && r.fingerprint === timelineFingerprint(timeline));
    return {
      timelineId: args.timelineId,
      reviewMode: row.reviewMode ?? "visual",
      qualityChecks: checksFor(row, args.timelineId),
      ...(!args.acceptedFindings?.length && cached ? { cachedResult: JSON.parse(cached.result) } : {}),
      request: {
        qualityChecks: checksFor(row, args.timelineId),
        assetId: String(row.assetId),
        candidateId: choice.candidateId,
        clippingRunId: row.runId,
        start: choice.start,
        end: choice.end,
        payoffEnd: candidate.payoff.end,
        reactionEnd,
        criticalRegions: choice.criticalRegions ?? [],
        ...(args.acceptedFindings
          ? { acceptedFindings: args.acceptedFindings }
          : {}),
      },
    };
  },
});

/** Only an explicit checkClip selection enables heavy QA. */
export const selectChecks = internalMutation({
  args: { ...runArgs, checks: v.array(qualityCheck), timelineIds: v.optional(v.array(v.string())) }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId) throw new ConvexError('Start this clip batch first.');
    const checks = [...new Set(args.checks)].sort();
    if (JSON.stringify(checks) !== JSON.stringify(row.qualityChecks ?? []) || JSON.stringify(args.timelineIds) !== JSON.stringify(row.qualityTimelineIds))
      await ctx.db.patch(row._id, { qualityChecks: checks, qualityTimelineIds: args.timelineIds, receipts: [] });
    return null;
  },
});

/** A small persisted inspection budget spans MCP calls and model resumptions. */
export const reserveVisual = internalMutation({
  args: { ...runArgs, assetId: v.id('assets'), start: v.number(), end: v.number(), question: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId || row.assetId !== args.assetId) throw new ConvexError('Call findHighlights for this source before inspecting clipping candidates.');
    const source = await ctx.db.get(row.assetId);
    if (!source?.duration || args.start < 0 || args.end > source.duration || args.end <= args.start || args.end - args.start > 60)
      throw new ConvexError('Clip video inspections require a specific SOURCE window of at most 60 seconds.');
    const windows = row.visualWindows ?? [], key = JSON.stringify([args.start, args.end, args.question.trim()]);
    const prior = windows.find(w => w.key === key);
    if (prior) {
      if (prior.result) return { cached: JSON.parse(prior.result) };
      if (Date.now() - prior.createdAt <= INSPECTION_TIMEOUT_MS) return { pending: true };
      return { cached: { available: false, reason: 'The targeted inspection was interrupted; no visual observation was recorded. Leave this candidate unresolved rather than repeating a sweep.' } };
    }
    if (!visualBudgetFits(row, source.duration, args.end - args.start))
      throw new ConvexError(`This batch reached its bounded visual-inspection budget (${VISUAL_WINDOWS} windows / ${VISUAL_SECONDS} source seconds maximum). Register the spoken and observed moments; planClips found returns the rest as unresolved. Do not sweep the source.`);
    const token = crypto.randomUUID();
    await ctx.db.patch(row._id, { visualWindows: [...windows, { key, start: args.start, end: args.end, token, createdAt: Date.now() }] });
    return { token };
  },
});
export const recordVisual = internalMutation({
  args: { ...runArgs, token: v.string(), result: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId || !row.visualWindows?.some(w => w.token === args.token)) throw new ConvexError('Video inspection reservation is stale.');
    await ctx.db.patch(row._id, { visualWindows: row.visualWindows.map(w => w.token === args.token && !w.result ? { ...w, result: args.result } : w) });
    return null;
  },
});

/** Transcript receipts come from authoritative saved tabs; no worker or image is involved. */
export const checkTranscript = internalMutation({
  args: { ...runArgs, timelineId: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId), row = await rowFor(ctx, args);
    if (!row || row.ownerId !== args.ownerId || !row.reviewed || checksFor(row, args.timelineId).length)
      throw new ConvexError('A reviewed plan without selected heavy QA is required for data-only checks.');
    const tab = tabsOf(project).find(t => t.id === args.timelineId);
    const choice = row.accepted.find(c => c.timelineId === args.timelineId || (!c.timelineId && c.name === tab?.name));
    const candidate = choice && candidatesOf(row).find(c => c.id === choice.candidateId);
    const raw = await ctx.db.get(row.assetId), timeline = await storedTabTimeline(ctx, project, args.timelineId);
    if (!tab || !choice || !candidate || !raw || !timeline) throw new ConvexError('The accepted tab or source is missing.');
    const asset = await hydrateAsset(ctx, raw);
    const result = checkClipData(timeline, [{ ...asset, url: null }], {
      reviewMode: row.reviewMode === 'transcript' ? 'transcript' : 'data', qualityChecks: [], assetId: String(row.assetId), start: choice.start, end: choice.end,
      payoffEnd: candidate.payoff.end, reactionEnd: candidate.reactionEnd, criticalRegions: choice.criticalRegions ?? [],
    });
    await ctx.db.patch(row._id, { receipts: [...row.receipts.filter(r => r.timelineId !== args.timelineId), {
      timelineId: args.timelineId, fingerprint: timelineFingerprint(timeline), result: JSON.stringify(result),
    }] });
    return { timelineId: args.timelineId, ...result };
  },
});

/** Only the leased worker's completion handler issues these receipts. */
export async function recordClipCheck(
  ctx: MutationCtx,
  snapshot: Doc<"frameSnapshots">,
  json: string,
) {
  const request = snapshot.clipCheck,
    result = clipCheckResult.parse(JSON.parse(json));
  if (!request || !snapshot.timelineId || !snapshot.sourceTimeline)
    throw new ConvexError("Clip check is missing its immutable tab snapshot.");
  const row = await rowFor(ctx, {
    projectId: snapshot.projectId,
    runId: request.clippingRunId,
  });
  if (
    !row ||
    row.ownerId !== snapshot.ownerId ||
    !row.accepted.some((c) => c.candidateId === request.candidateId)
  )
    throw new ConvexError("The clip plan changed while checking.");
  const choice = row.accepted.find(
    (c) => c.candidateId === request.candidateId,
  );
  if (
    !choice ||
    choice.start !== request.start ||
    choice.end !== request.end ||
    JSON.stringify(choice.criticalRegions ?? []) !==
      JSON.stringify(request.criticalRegions)
  )
    throw new ConvexError(
      "The accepted range or critical regions changed during checkClip.",
    );
  const timeline = snapshot.sourceTimeline;
  const raw = await ctx.db.get(row.assetId);
  if (!raw) throw new ConvexError("Source removed during check.");
  const asset = await hydrateAsset(ctx, raw),
    data = checkClipData(timeline, [{ ...asset, url: null }], request);
  // Recompute data checks on the server; a worker result cannot omit a failure.
  for (const check of data.checks) {
    const actual = result.checks.find((c) => c.name === check.name);
    if (!actual || actual.passed !== check.passed)
      throw new ConvexError(
        "Clip check does not match current source evidence.",
      );
  }
  if (
    result.passed !== result.checks.every((c) => c.passed) ||
    ((request.qualityChecks ?? []).includes("decode-health") && !result.checks.some((c) => c.name === "decode-health"))
  )
    throw new ConvexError("Incomplete clip check.");
  await ctx.db.patch(row._id, {
    receipts: [
      ...row.receipts.filter((r) => r.timelineId !== snapshot.timelineId),
      {
        timelineId: snapshot.timelineId,
        fingerprint: timelineFingerprint(timeline),
        result: json,
      },
    ],
  });
}

/** Whether this task started its own clipping run (findHighlights or planClips). A clip-lane follow-up edit on a finished short has none. */
export const runStarted = internalQuery({
  args: runArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, args.ownerId);
    const row = await rowFor(ctx, args);
    return !!row && row.ownerId === args.ownerId;
  },
});
export const completionState = internalQuery({
  args: {
    ...runArgs,
    timeline: v.optional(timelineValidator),
    timelineId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId, args.ownerId),
      row = await rowFor(ctx, args);
    if (!row)
      return {
        required: false,
        passed: false,
        errors: [
          "This request asks Revline to choose the moments: call findHighlights and planClips before reporting it complete.",
        ],
      };
    if (row.ownerId !== args.ownerId)
      throw new ConvexError("Clipping plan is unavailable.");
    if (!row.delivery)
      return {
        required: false,
        passed: true,
        ...(row.unavailableReason
          ? { geminiUnavailableReason: row.unavailableReason }
          : {}),
        found: candidatesOf(row).length,
        accepted: 0,
        tabsCreated: 0,
        tabs: [],
        dropped: [],
        errors: [],
      };
    if (args.timeline) {
      const selected = args.timelineId ?? activeTabOf(project),
        saved = await storedTabTimeline(ctx, project, selected);
      if (
        !saved ||
        timelineFingerprint(saved) !== timelineFingerprint(args.timeline)
      ) {
        const draft = await ctx.db
          .query("aiTimelinePreviews")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .unique();
        if (
          selected !== activeTabOf(project) ||
          !draft ||
          draft.baseRevision !== (project.revision ?? 0) ||
          draft.runId !== project.aiRunId ||
          timelineFingerprint(draft.timeline) !==
            timelineFingerprint(args.timeline)
        )
          return {
            required: true,
            passed: false,
            errors: [
              "The supplied timeline is stale or is not the saved server draft. Inspect the current tab and retry completion with its saved data.",
            ],
          };
      }
    }
    const contents = await tabContents(
        ctx,
        project,
        args.timeline,
        args.timelineId,
      ),
      errors: string[] = [],
      tabs: {
        timelineId: string;
        name: string;
        start: number;
        end: number;
        duration: number;
        candidateId: string;
        checked:boolean;
      }[] = [];
    if (!row.reviewed) errors.push("Review candidates and call planClips.");
    // Nothing accepted means nothing delivered: a pass here let agents report
    // "done" with zero tabs and then fail finish. Stop early instead.
    else if (!row.accepted.length)
      errors.push(
        `No candidate was accepted, so no clip was delivered.${row.shortfallReason ? ` Shortfall recorded: ${row.shortfallReason}` : ""} Accept at least one qualified candidate and build its tab, or stop and tell the user that no moment qualified; finishClipping cannot pass with zero clips.`,
      );
    const sourceRaw = await ctx.db.get(row.assetId);
    const source = sourceRaw ? await hydrateAsset(ctx, sourceRaw) : null;
    const candidates = candidatesOf(row);
    if(row.reviewed&&row.accepted.length<targetCount(row,source?.duration??0)&&!row.dropped.length&&(!row.shortfallReason||row.shortfallReason.trim().length<20))errors.push("Explain the quality/context/boundary shortfall with planClips shortfallReason before finishing fewer than the source-length target.");
    const bound = new Set<string>();
    for (const choice of row.accepted) {
      const tab = contents.find((t) =>
        choice.timelineId ? t.id === choice.timelineId : t.name === choice.name,
      );
      if (!tab) {
        errors.push(`${choice.name}: missing tab.`);
        continue;
      }
      if (bound.has(tab.id)) {
        errors.push(`${choice.name}: one tab cannot deliver two candidates.`);
        continue;
      }
      bound.add(tab.id);
      if (tab.name !== choice.name)
        errors.push(
          `${choice.name}: tab name does not match the accepted clip.`,
        );
      const candidate = candidates.find((c) => c.id === choice.candidateId);
      let dataPassed=false;
      if (source && candidate) {
        const data = checkClipData(tab.timeline, [{ ...source, url: null }], {
          reviewMode: row.reviewMode === "transcript" ? "transcript" : "data",
          qualityChecks: [],
          assetId: String(row.assetId),
          start: choice.start,
          end: choice.end,
          payoffEnd: candidate.payoff.end,
          reactionEnd: candidate.reactionEnd,
          criticalRegions: choice.criticalRegions ?? [],
        });
        dataPassed=data.passed;
        errors.push(
          ...data.checks
            .filter((c) => !c.passed)
            .flatMap((c) =>
              c.reasons.map((reason) => `${choice.name}: ${reason}`),
            ),
        );
      } else
        errors.push(`${choice.name}: accepted source evidence is missing.`);
      const requestedChecks = checksFor(row, tab.id);
      const receipt = row.receipts.find((r) => r.timelineId === tab.id),
        fingerprint = timelineFingerprint(tab.timeline);
      if (requestedChecks.length && (!receipt || receipt.fingerprint !== fingerprint))
        errors.push(
          `${choice.name}: run checkClip on the current tab; its receipt is missing or stale.`,
        );
      else if (requestedChecks.length && receipt) {
        const result = clipCheckResult.parse(JSON.parse(receipt.result));
        if (!result.passed)
          errors.push(
            ...result.checks
              .filter((c) => !c.passed)
              .flatMap((c) =>
                c.reasons.map((reason) => `${choice.name}: ${reason}`),
              ),
          );
      }
      if (
        !tab.timeline.clips.some(
          (c) => c.kind === "video" && c.assetId === row.assetId,
        )
      )
        errors.push(`${choice.name}: needs populated source footage.`);
      tabs.push({
        timelineId: tab.id,
        name: tab.name,
        start: choice.start,
        end: choice.end,
        duration: timelineDuration(tab.timeline),
        candidateId: choice.candidateId,
        checked:dataPassed&&(!requestedChecks.length||!!receipt&&receipt.fingerprint===fingerprint&&clipCheckResult.parse(JSON.parse(receipt.result)).passed),
      });
    }
    for (const tab of contents) {
      const baseline = row.baseline.find((b) => b.id === tab.id);
      if (
        (!baseline ||
          baseline.fingerprint !== timelineFingerprint(tab.timeline)) &&
        !bound.has(tab.id)
      )
        errors.push(
          `${tab.name}: extra created/changed tab is not in the accepted list. Restore it or account for the candidate.`,
        );
    }
    const created=tabs.filter(tab=>!row.baseline.some(b=>b.id===tab.timelineId)).length;
    const changed=tabs.filter(tab=>{const baseline=row.baseline.find(b=>b.id===tab.timelineId),content=contents.find(t=>t.id===tab.timelineId);return baseline&&content&&baseline.fingerprint!==timelineFingerprint(content.timeline);}).length;
    const reused=tabs.length-created-changed;
    const passed = !errors.length;
    const message = passed
      ? `Delivered ${tabs.length} clips${reused?` (${created} new, ${changed} updated, ${reused} reused)`:""}:\n${tabs.map((t) => `- ${t.name}: source ${t.start.toFixed(2)}-${t.end.toFixed(2)}s, ${t.duration.toFixed(2)}s.`).join("\n")}${row.dropped.length ? `\nDropped after review: ${row.dropped.map((d) => `${candidates.find((c) => c.id === d.candidateId)?.title ?? d.candidateId}: ${d.reason}`).join("; ")}` : ""}`
      : undefined;
    return {
      required: true,
      passed,
      ...(row.unavailableReason
        ? { geminiUnavailableReason: row.unavailableReason }
        : {}),
      found: candidates.length,
      qualified: candidates.filter((c) => c.qualified).length,
      recommended: row.recommendedCount,
      accepted: row.accepted.length,
      reviewMode: row.reviewMode ?? "visual",
      tabsCreated: created,
      tabsChanged: changed,
      tabsReused: reused,
      tabsDelivered: tabs.length,
      tabs,
      dropped: row.dropped,
      errors,
      ...(message
        ? {
            finalMessage:
              message +
              ("\nSaved source/timeline data and available word timings checked; unrequested visual, decode and loudness checks were skipped." + (row.qualityChecks?.length ? ` Optional QA: ${row.qualityChecks.join(', ')} on ${row.qualityTimelineIds?.length ?? tabs.length} tab(s).` : ""))+
              (row.shortfallReason?`\nFewer clips qualified: ${row.shortfallReason}`:"")+
              (row.unresolved?.length ? `\nLeft out without video evidence: ${row.unresolved.map((u) => `${u.title} (${u.start.toFixed(2)}-${u.end.toFixed(2)}s): ${u.reason}`).join("; ")}` : "")+
              (row.unavailableReason
                ? "\nGemini was unavailable; picks used transcript and audio."
                : ""),
          }
        : {}),
    };
  },
});
