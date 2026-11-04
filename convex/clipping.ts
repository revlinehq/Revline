import { ConvexError, v } from "convex/values";
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
  timelineFingerprint,
} from "../lib/media-analysis/clip-check";
import {
  defaultClipCount,
  HIGHLIGHT_QUALITY_BAR,
  rankHighlights,
  readHighlights,
  semanticMoment,
  type SourceType,
} from "../lib/media-analysis/highlights";
import {
  clippingChoice,
  fallbackMoment,
  clipCheckRequestValidator,
} from "./lib/clipping_validator";
import { timelineDuration, type Timeline } from "../lib/editor/types";
import { timelineValidator } from "./schema";
import { loadSceneCode } from "./lib/scene_code";

const runArgs = {
  ownerId: v.string(),
  projectId: v.id("projects"),
  runId: v.string(),
};
const runKey = (runId: string) =>
  runId.startsWith("mcp-task:")
    ? runId
    : runId.startsWith("mcp-")
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
const candidatesOf = (row: Doc<"clippingRuns">): Candidate[] =>
  JSON.parse(row.candidates);
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
    sourceType: v.optional(
      v.union(
        v.literal("podcast"),
        v.literal("gaming"),
        v.literal("irl"),
        v.literal("sports"),
        v.literal("talk"),
      ),
    ),
    count: v.optional(v.number()),
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
    const asset = await hydrateAsset(ctx, raw),
      tracks = readHighlights(asset.analysis?.highlights);
    if (!tracks)
      throw new ConvexError(
        "Highlight discovery has no saved source analysis.",
      );
    const candidates = rankHighlights(
      tracks,
      asset.analysis?.transcript,
      args.sourceType as SourceType | undefined,
    ).map((c) => ({
      ...c,
      evidence: c.evidence.sort((a, b) => b.strength - a.strength).slice(0, 24),
    }));
    const qualified = candidates.filter((c) => c.qualified).length;
    const recommendedCount = Math.min(
      args.count ??
        (tracks.judge === "fallback"
          ? Math.min(10, Math.max(3, Math.round(tracks.duration / 150)))
          : defaultClipCount(tracks.duration, qualified)),
      tracks.judge === "fallback" ? 10 : qualified,
      Math.max(0, MAX_TIMELINE_TABS - tabsOf(project).length),
    );
    const previous = await rowFor(ctx, args);
    // Continuing a run never erases its accepted list or its original baseline.
    if (previous && previous.assetId !== asset._id)
      throw new ConvexError(
        "Finish this source batch before starting another in the same run.",
      );
    if (!previous) {
      const tabs = await tabContents(ctx, project);
      await ctx.db.insert("clippingRuns", {
        ownerId: args.ownerId,
        projectId: args.projectId,
        runId: runKey(args.runId),
        assetId: asset._id,
        createdAt: Date.now(),
        delivery: args.delivery,
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
        ...(tracks.unavailableReason
          ? { unavailableReason: tracks.unavailableReason }
          : {}),
      });
    else if (args.delivery && !previous.delivery)
      await ctx.db.patch(previous._id, { delivery: true });
    return {
      assetId: asset._id,
      sourceType: args.sourceType ?? tracks.sourceType,
      typeReason: tracks.typeReason,
      found: candidates.length,
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
      discoveryMode: tracks.judge,
      ...(tracks.judge === "fallback"
        ? {
            geminiUnavailableReason: tracks.unavailableReason,
            transcript: asset.analysis?.transcript?.segments ?? [],
            peaks: tracks.signals
              .filter((s) => s.kind === "spike")
              .sort((a, b) => b.strength - a.strength)
              .slice(0, 60),
            sceneCuts:
              asset.analysis?.shots?.shots.map((s) => s.start) ??
              tracks.sceneCuts,
            next: "Gemini unavailable: do not call it again in this run. Read the transcript across the source, inspect shortlisted source frames, then call planClips found with grounded hooks/payoffs, score and evidence. The server returns candidate IDs; accept/drop those IDs in the next planClips call. Never stop at suggestions when clips were requested.",
          }
        : {}),
      note: "Review top 8-10. Call planClips with accepted IDs and named tabs; give reasons for rejected reviewed candidates. checkClip each tab, then finishClipping. Never pad to the count.",
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
      throw new ConvexError("Call findHighlights before planning this batch.");
    if (args.found) {
      if (!row.unavailableReason)
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
        tracks = readHighlights(source.analysis?.highlights);
      if (!tracks) throw new ConvexError("Source helper analysis is missing.");
      const normalize = (text: string) =>
        text
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
      const moments = args.found.map((raw) => {
        const m = semanticMoment.parse(raw);
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
        for (const line of [m.hook, m.payoff])
          if (line.text.trim()) {
            const measured = (source.analysis?.transcript?.words ?? [])
              .filter(
                (w) => w.start >= line.start - 0.2 && w.end <= line.end + 0.2,
              )
              .map((w) => w.text)
              .join(" ");
            if (!normalize(measured).includes(normalize(line.text)))
              throw new ConvexError(
                "Fallback hook/payoff quotes must match the saved word timings. Leave non-verbal lines empty and describe checked source frames.",
              );
          }
        return m;
      });
      const candidates = rankHighlights(
        { ...tracks, judge: "fallback", moments },
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
      });
      return {
        found: candidates.length,
        qualified,
        recommendedCount,
        sourceLengthTarget:targetCount(row,tracks.duration),
        candidates: candidates.slice(0, 10),
        geminiUnavailableReason: row.unavailableReason,
        next: "Accept or drop each returned candidate ID with planClips, then build exactly the accepted tabs and run checkClip/finishClipping.",
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
    for (const choice of args.accepted) {
      const candidate = candidates.find((c) => c.id === choice.candidateId);
      if (!candidate || !candidate.qualified || ids.has(choice.candidateId))
        throw new ConvexError(
          "Accept distinct candidates that pass the quality bar.",
        );
      if (
        !choice.name.trim() ||
        choice.name.length > 60 ||
        ![choice.start, choice.end].every(Number.isFinite) ||
        choice.end - choice.start < 15 ||
        choice.end - choice.start > 60 ||
        choice.start > candidate.hook.start + 0.1 ||
        choice.end < candidate.payoff.end - 0.03 ||
        Math.abs(choice.start - candidate.start) > 12 ||
        Math.abs(choice.end - candidate.end) > 12
      )
        throw new ConvexError(
          `Invalid clean range or missing hook/payoff for ${choice.candidateId}.`,
        );
      ids.add(choice.candidateId);
    }
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
      ...(row.unavailableReason
        ? { geminiUnavailableReason: row.unavailableReason }
        : {}),
      found: candidates.length,
      qualified: candidates.filter((c) => c.qualified).length,
      recommended: row.recommendedCount,
      discardedTabs,
      accepted: args.accepted,
      dropped: args.dropped,
      next: "Build exactly these populated 9:16 tabs. Bind their timelineIds by calling planClips again, or use the exact unique tab names. Run checkClip after normalization.",
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
    return {
      timelineId: args.timelineId,
      request: {
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
  const timeline = await loadSceneCode(ctx, snapshot.sourceTimeline);
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
    !result.checks.some((c) => c.name === "decode-health")
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
          "Call findHighlights and planClips before reporting this clipping request complete.",
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
          timelineFingerprint(await loadSceneCode(ctx, draft.timeline)) !==
            timelineFingerprint(args.timeline)
        )
          return {
            required: true,
            passed: false,
            errors: [
              "The supplied timeline is stale or is not the saved server draft. Inspect the current tab and rerun checkClip.",
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
      const receipt = row.receipts.find((r) => r.timelineId === tab.id),
        fingerprint = timelineFingerprint(tab.timeline);
      if (!receipt || receipt.fingerprint !== fingerprint)
        errors.push(
          `${choice.name}: run checkClip on the current tab; its receipt is missing or stale.`,
        );
      else {
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
        tab.timeline.aspectRatio !== "vertical" ||
        !tab.timeline.clips.some(
          (c) => c.kind === "video" && c.assetId === row.assetId,
        )
      )
        errors.push(`${choice.name}: needs populated 9:16 source footage.`);
      tabs.push({
        timelineId: tab.id,
        name: tab.name,
        start: choice.start,
        end: choice.end,
        duration: timelineDuration(tab.timeline),
        candidateId: choice.candidateId,
        checked:dataPassed&&!!receipt&&receipt.fingerprint===fingerprint&&clipCheckResult.parse(JSON.parse(receipt.result)).passed,
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
      ? `${tabs.length ? `Delivered ${tabs.length} clips${reused?` (${created} new, ${changed} updated, ${reused} reused)`:""}:\n${tabs.map((t) => `- ${t.name}: source ${t.start.toFixed(2)}-${t.end.toFixed(2)}s, ${t.duration.toFixed(2)}s.`).join("\n")}` : "No clips created."}${row.dropped.length ? `\nDropped after review: ${row.dropped.map((d) => `${candidates.find((c) => c.id === d.candidateId)?.title ?? d.candidateId}: ${d.reason}`).join("; ")}` : !tabs.length ? " No distinct 15-60s moments passed review and the clean-boundary quality bar." : ""}`
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
              (row.shortfallReason?`\nFewer clips qualified: ${row.shortfallReason}`:"")+
              (row.unavailableReason
                ? "\nGemini was unavailable; picks used transcript and audio."
                : ""),
          }
        : {}),
    };
  },
});
