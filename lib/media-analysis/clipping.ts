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
export const speakerAnalysis = z
  .object({
    version: z.literal(1),
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
  })
  .superRefine((analysis, ctx) => {
    if (
      analysis.end <= analysis.start ||
      analysis.turns.some(
        (turn, i) =>
          turn.start < analysis.start ||
          turn.end > analysis.end + 0.001 ||
          (i > 0 && turn.start < analysis.turns[i - 1].start),
      ) ||
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

/** Hold short interjections and uncertain turns; ease confirmed switches over 600 ms. */
export function speakerFocus(
  turns: SpeakerAnalysis["turns"],
  duration: number,
  tracked: SpeakerAnalysis["focus"] = [],
): SpeakerAnalysis["focus"] {
  const points: SpeakerAnalysis["focus"] = [{ time: 0, x: 0.5, y: 0.5 }];
  let current = { x: 0.5, y: 0.5 },
    speaker = -1,
    lastSwitch = -2;
  for (const turn of turns) {
    if (!turn.face || turn.confidence < 0.7 || turn.end - turn.start < 0.8)
      continue;
    const target = {
      x: turn.face.x + turn.face.w / 2,
      y: turn.face.y + turn.face.h / 2,
    };
    if (speaker === -1 && turn.start === 0) {
      current = target;
      speaker = turn.speaker;
      lastSwitch = 0;
      points[0] = { time: 0, ...current };
    }
    const switching =
      speaker !== turn.speaker ||
      Math.hypot(target.x - current.x, target.y - current.y) >= 0.06;
    const start = Math.max(
        turn.start,
        speaker !== turn.speaker ? lastSwitch + 1.2 : 0,
        (points.at(-1)?.time ?? 0) + 0.001,
      ),
      end = Math.min(duration, start + 0.6);
    if (end <= start || start >= turn.end) continue;
    if (switching) {
      points.push({ time: start, ...current });
      for (let i = 1; i <= 6; i++) {
        const u = i / 6,
          ease = u * u * (3 - 2 * u);
        points.push({
          time: start + (end - start) * u,
          x: current.x + (target.x - current.x) * ease,
          y: current.y + (target.y - current.y) * ease,
        });
      }
      current = target;
      speaker = turn.speaker;
      lastSwitch = start;
    }
    for (const sample of tracked) {
      if (
        sample.time < end ||
        sample.time >= turn.end ||
        sample.time <= (points.at(-1)?.time ?? 0)
      )
        continue;
      if (Math.hypot(sample.x - current.x, sample.y - current.y) < 0.03)
        continue;
      current = {
        x: current.x * 0.65 + sample.x * 0.35,
        y: current.y * 0.65 + sample.y * 0.35,
      };
      points.push({ time: sample.time, ...current });
    }
  }
  if ((points.at(-1)?.time ?? 0) < duration)
    points.push({ time: duration, ...current });
  return points;
}
