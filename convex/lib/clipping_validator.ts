import { v } from "convex/values";
export const qualityCheck = v.union(v.literal('framing'), v.literal('decode-health'), v.literal('loudness'));
export const clipCheckRequestValidator = v.object({
  qualityChecks: v.optional(v.array(qualityCheck)),
  assetId: v.string(),
  candidateId: v.string(),
  clippingRunId: v.string(),
  start: v.number(),
  end: v.number(),
  payoffEnd: v.number(),
  reactionEnd: v.number(),
  criticalRegions: v.array(
    v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
  ),
  acceptedFindings: v.optional(
    v.array(
      v.object({
        kind: v.union(v.literal("freeze"), v.literal("black")),
        reason: v.string(),
      }),
    ),
  ),
});
export const clipSourceType = v.union(
  v.literal("podcast"),
  v.literal("gaming"),
  v.literal("irl"),
  v.literal("sports"),
  v.literal("talk"),
);
const line = v.object({ start: v.number(), end: v.number(), text: v.string() });
export const fallbackMoment = v.object({
  start: v.number(),
  end: v.number(),
  title: v.string(),
  kind: v.union(
    v.literal("punchline"),
    v.literal("story"),
    v.literal("opinion"),
    v.literal("quote"),
    v.literal("question-answer"),
    v.literal("action"),
  ),
  hook: line,
  payoff: line,
  reactionEnd: v.number(),
  score: v.number(),
  reason: v.string(),
});
export const clippingChoice = v.object({
  candidateId: v.string(),
  name: v.string(),
  start: v.number(),
  end: v.number(),
  timelineId: v.optional(v.string()),
  criticalRegions: v.optional(
    v.array(
      v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
    ),
  ),
});
export const clippingManifest = v.object({
  ownerId: v.string(),
  projectId: v.id("projects"),
  runId: v.string(),
  assetId: v.id("assets"),
  createdAt: v.number(),
  delivery: v.boolean(),
  targeted: v.optional(v.boolean()),
  qualityTimelineIds: v.optional(v.array(v.string())),
  qualityChecks: v.optional(v.array(qualityCheck)),
  visualWindows: v.optional(v.array(v.object({ key: v.string(), start: v.number(), end: v.number(), token: v.string(), createdAt: v.number(), result: v.optional(v.string()) }))),
  reviewMode: v.optional(v.union(v.literal("transcript"), v.literal("visual"))),
  // The type the agent declared to findHighlights; found moments are ranked with it.
  sourceType: v.optional(clipSourceType),
  // Visual moments found left out because no video observation could be made.
  unresolved: v.optional(v.array(v.object({ title: v.string(), start: v.number(), end: v.number(), reason: v.string() }))),
  unavailableReason: v.optional(v.string()),
  candidates: v.string(),
  recommendedCount: v.number(),
  requestedCount: v.optional(v.number()),
  shortfallReason:v.optional(v.string()),
  reviewed: v.boolean(),
  accepted: v.array(clippingChoice),
  dropped: v.array(v.object({ candidateId: v.string(), reason: v.string() })),
  baseline: v.array(v.object({ id: v.string(), fingerprint: v.string() })),
  receipts: v.array(
    v.object({
      timelineId: v.string(),
      fingerprint: v.string(),
      result: v.string(),
    }),
  ),
});
