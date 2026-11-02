import { v } from "convex/values";
export const normalizationRequestValidator = v.object({
  clipId: v.optional(v.string()),
  targetLufs: v.number(),
  truePeak: v.number(),
});
export const normalizationResultValidator = v.object({
  assetId: v.id("assets"),
  inputLufs: v.number(),
  outputLufs: v.number(),
  truePeak: v.number(),
  start: v.number(),
  duration: v.number(),
});
