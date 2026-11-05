import { z } from "zod";

export const normalizedRect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine(
    (r) => r.x + r.w <= 1.000001 && r.y + r.h <= 1.000001,
    "Rectangle must fit the source.",
  );
export const facecamSample = z
  .object({
    time: z.number().nonnegative(),
    kind: z.enum(["overlay", "creator-only", "gameplay-only", "uncertain"]),
    facecam: normalizedRect.nullable(),
    gameplay: normalizedRect.nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500),
  })
  .superRefine((s, ctx) => {
    if (
      (s.kind === "overlay" && (!s.facecam || !s.gameplay)) ||
      (s.kind === "creator-only" && (!s.facecam || s.gameplay)) ||
      (s.kind === "gameplay-only" && (s.facecam || !s.gameplay))
    )
      ctx.addIssue({
        code: "custom",
        message: "Regions must match the detected layout.",
      });
  });
export const facecamAnalysis = z.object({
  version: z.literal(1),
  samples: z.array(facecamSample).min(1).max(80),
});
export type FacecamAnalysis = z.infer<typeof facecamAnalysis>;
export const speakerTurn = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
    speaker: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    face: normalizedRect.nullable(),
  })
  .refine((t) => t.end > t.start);
export const MAX_SPEAKER_WINDOW_SECONDS = 120;
export const SPEAKER_ANALYSIS_VERSION = 2;
const speakerFraming = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  shot: z.number().int().nonnegative(),
  method: z.enum(["shot-dominant", "turn-mouth", "identity-reuse", "fallback"]),
  confidence: z.number().min(0).max(1),
  face: normalizedRect.nullable(),
  faceId: z.number().int().nonnegative().nullable(),
  speaker: z.number().int().nonnegative().nullable(),
});
const speakerBase = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  identityScope: z.enum(["source", "window"]),
  turns: z.array(speakerTurn).max(2000),
  focus: z
    .array(
      z.object({
        time: z.number().nonnegative(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .max(10000),
});
export const speakerAnalysis = z
  .discriminatedUnion("version", [
    speakerBase.extend({ version: z.literal(1) }),
    speakerBase.extend({
      version: z.literal(SPEAKER_ANALYSIS_VERSION),
      framing: z.array(speakerFraming).min(1).max(10000),
    }),
  ])
  .superRefine((analysis, ctx) => {
    if (
      analysis.end <= analysis.start ||
      analysis.turns.some(
        (turn, i) =>
          turn.start < analysis.start ||
          turn.end > analysis.end + 0.001 ||
          (i > 0 && turn.start < analysis.turns[i - 1].start),
      ) ||
      (analysis.version === SPEAKER_ANALYSIS_VERSION &&
        analysis.framing.length > 0 &&
        (Math.abs(analysis.framing[0].start - analysis.start) > 0.001 ||
          Math.abs(analysis.framing.at(-1)!.end - analysis.end) > 0.001 ||
          analysis.framing.some(
            (frame, i) =>
              frame.end <= frame.start ||
              frame.start < analysis.start ||
              frame.end > analysis.end + 0.001 ||
              (frame.method === "fallback"
                ? frame.face !== null || frame.confidence !== 0
                : !frame.face || frame.confidence < 0.7) ||
              (i > 0 &&
                (Math.abs(frame.start - analysis.framing[i - 1].end) > 0.001 ||
                  frame.shot < analysis.framing[i - 1].shot)),
          ))) ||
      analysis.focus.some(
        (point, i) =>
          point.time < analysis.start ||
          point.time > analysis.end + 0.001 ||
          (i > 0 && point.time <= analysis.focus[i - 1].time),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Speaker evidence must stay ordered inside its analyzed source window.",
      });
  });
export type SpeakerAnalysis = z.infer<typeof speakerAnalysis>;
export type SpeakerFraming = z.infer<typeof speakerFraming>;

/** Fixed shot anchors. Adjacent timestamps encode a hard cut in the shared linear crop path. */
export function speakerFocus(
  framing: SpeakerFraming[],
  duration: number,
): SpeakerAnalysis["focus"] {
  const points: SpeakerAnalysis["focus"] = [];
  let current = { x: 0.5, y: 0.5 },
    shot = -1,
    faceId: number | null = null;
  const push = (time: number, position: typeof current) => {
    if (time > (points.at(-1)?.time ?? -1)) points.push({ time, ...position });
  };
  for (const frame of framing) {
    const target = frame.face
      ? {
          x: frame.face.x + frame.face.w / 2,
          y: frame.face.y + frame.face.h / 2,
        }
      : null;
    if (frame.shot !== shot) {
      // ffprobe rounds PTS to microseconds. Arrive one microsecond early so a
      // rounded-up boundary cannot interpolate the crop on the first cut frame.
      if (frame.start > 0) push(frame.start - 0.000002, current);
      current = target ?? { x: 0.5, y: 0.5 };
      push(Math.max(0, frame.start - 0.000001), current);
      shot = frame.shot;
      faceId = frame.faceId;
    } else if (target && frame.faceId !== faceId) {
      push(frame.start, current);
      const end = Math.min(frame.end, frame.start + 0.6);
      for (let i = 1; i <= 6; i++) {
        const u = i / 6,
          ease = u * u * (3 - 2 * u);
        push(frame.start + (end - frame.start) * u, {
          x: current.x + (target.x - current.x) * ease,
          y: current.y + (target.y - current.y) * ease,
        });
      }
      current = target;
      faceId = frame.faceId;
    }
    push(frame.end - 0.000002, current);
  }
  push(duration, current);
  return points;
}

/** Duration-weighted heuristic confidence, clipped to the actual retained source range. */
export function summarizeSpeakerFraming(
  analysis: SpeakerAnalysis,
  start = analysis.start,
  end = analysis.end,
  timeAtSource: (time: number) => number = (time) => time,
) {
  if (analysis.version !== SPEAKER_ANALYSIS_VERSION) return null;
  return ["shot-dominant", "turn-mouth", "identity-reuse", "fallback"].map(
    (method) => {
      const frames = analysis.framing.filter(
        (frame) => frame.method === method,
      );
      const overlap = (frame: SpeakerFraming) => {
        const a = Math.max(start, frame.start),
          b = Math.min(end, frame.end);
        return b > a ? timeAtSource(b) - timeAtSource(a) : 0;
      };
      const seconds = frames.reduce((sum, frame) => sum + overlap(frame), 0);
      const weighted = frames.reduce(
        (sum, frame) => sum + overlap(frame) * frame.confidence,
        0,
      );
      return { method, seconds, confidence: seconds ? weighted / seconds : 0 };
    },
  );
}
