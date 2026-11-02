import {
  speakerFocus,
  type SpeakerAnalysis,
  type SpeakerFraming,
} from "../media-analysis/clipping";
import type { ShotDetection } from "../media-analysis/shots";
import type { SourceFaceEvidence } from "./source-face-evidence";

type Face = SourceFaceEvidence["samples"][number]["faces"][number];
type Turn = SpeakerAnalysis["turns"][number];
type Observation = {
  id: number;
  time: number;
  shot: number;
  face: Face;
  activity: number;
};
type Identity = {
  id: number;
  latest: Observation;
  appearance: number[] | undefined;
};
type Association = { id: number; confidence: number };
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const centerDistance = (a: Face, b: Face) =>
  Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
const rect = (rows: Observation[]) => {
  const x = median(rows.map((o) => o.face.x)),
    y = median(rows.map((o) => o.face.y));
  return {
    x,
    y,
    w: Math.min(1 - x, median(rows.map((o) => o.face.w))),
    h: Math.min(1 - y, median(rows.map((o) => o.face.h))),
  };
};
const appearanceDistance = (a: number[], b: number[]) =>
  0.7 * Math.sqrt(mean(a.slice(0, 64).map((value, i) => (value - b[i]) ** 2))) +
  0.3 *
    Math.sqrt(mean(a.slice(64).map((value, i) => (value - b[i + 64]) ** 2)));

/** Position continuity inside shots; conservative CPU appearance matching across cuts. */
function trackIdentities(
  evidence: SourceFaceEvidence,
  shots: ShotDetection["shots"],
) {
  const identities = new Map<number, Identity>(),
    observations: Observation[] = [];
  for (const [shot, bounds] of shots.entries()) {
    for (const sample of evidence.samples.filter(
      (sample) => sample.time >= bounds.start && sample.time < bounds.end,
    )) {
      const used = new Set<number>();
      for (const face of [...sample.faces].sort(
        (a, b) => b.w * b.h - a.w * a.h,
      )) {
        const nearby = [...identities.values()]
          .filter(
            (identity) =>
              !used.has(identity.id) &&
              identity.latest.shot === shot &&
              sample.time - identity.latest.time <= 0.6 &&
              identity.latest.face.w / face.w > 0.5 &&
              identity.latest.face.w / face.w < 2,
          )
          .map((identity) => ({
            identity,
            distance: centerDistance(identity.latest.face, face),
          }))
          .sort((a, b) => a.distance - b.distance);
        let identity =
          nearby[0]?.distance < 0.12 ? nearby[0].identity : undefined;
        if (!identity && face.appearance) {
          const appearance = face.appearance;
          const candidates = [...identities.values()]
            .filter(
              (candidate) =>
                !used.has(candidate.id) &&
                candidate.appearance &&
                (candidate.latest.shot !== shot ||
                  sample.time - candidate.latest.time > 0.6),
            )
            .flatMap((candidate) =>
              candidate.appearance
                ? [
                    {
                      identity: candidate,
                      distance: appearanceDistance(
                        appearance,
                        candidate.appearance,
                      ),
                    },
                  ]
                : [],
            )
            .sort((a, b) => a.distance - b.distance);
          const best = candidates[0];
          if (
            best &&
            best.distance < 0.11 &&
            (candidates[1]?.distance ?? 1) - best.distance > 0.025
          )
            identity = best.identity;
        }
        const previous = identity?.latest;
        const activity =
          previous &&
          previous.shot === shot &&
          sample.time - previous.time < 0.25 &&
          face.mouth !== null &&
          previous.face.mouth !== null
            ? Math.max(0, Math.abs(face.mouth - previous.face.mouth) - 0.008)
            : 0;
        const observation = {
          id: identity?.id ?? identities.size,
          time: sample.time,
          shot,
          face,
          activity,
        };
        if (identity) {
          identity.latest = observation;
          if (face.appearance) {
            const appearance = face.appearance;
            identity.appearance =
              identity.appearance?.map(
                (value, i) => value * 0.9 + appearance[i] * 0.1,
              ) ?? appearance;
          }
        } else {
          identity = {
            id: observation.id,
            latest: observation,
            appearance: face.appearance,
          };
          identities.set(identity.id, identity);
        }
        used.add(identity.id);
        observations.push(observation);
      }
    }
  }
  return observations;
}

/** Select one anchor per shot, then use complete audio turns for genuinely multi-face shots. */
export function matchSpeakingFaces(
  evidence: SourceFaceEvidence,
  detection: ShotDetection,
  turns: Turn[],
  duration: number,
): Extract<SpeakerAnalysis, { version: 2 }> {
  const observations = trackIdentities(evidence, detection.shots);
  const shotEvidence = detection.shots.map((bounds, shot) => {
    const samples = evidence.samples.filter(
      (sample) => sample.time >= bounds.start && sample.time < bounds.end,
    );
    const rows = observations.filter((o) => o.shot === shot);
    const faces = [...new Set(rows.map((o) => o.id))]
      .flatMap((id) => {
        const visible = rows.filter((o) => o.id === id),
          coverage = visible.length / Math.max(1, samples.length);
        if (coverage < 0.6 || visible.length < Math.min(3, samples.length))
          return [];
        const face = rect(visible);
        return [{ id, face, coverage, area: face.w * face.h }];
      })
      .sort((a, b) => b.area - a.area);
    const best = faces[0];
    // Include intermittent secondary faces in the area comparison, rather than dropping them.
    const dominance = best
      ? mean(
          samples.map((sample) => {
            const row = rows.filter((o) => o.time === sample.time),
              visible = row.find((o) => o.id === best.id);
            return visible
              ? (visible.face.w * visible.face.h) /
                  Math.max(
                    0.00001,
                    row.reduce((sum, o) => sum + o.face.w * o.face.h, 0),
                  )
              : 0;
          }),
        )
      : 0;
    const dominant =
      best &&
      best.coverage >= 0.7 &&
      dominance >= 0.72 &&
      (!faces[1] || best.area >= faces[1].area * 2.5)
        ? { ...best, confidence: Math.min(0.98, 0.7 + 0.28 * dominance) }
        : null;
    return { ...bounds, shot, rows, samples, faces, dominant };
  });
  const sustained = turns.filter(
    (turn) => turn.end - turn.start >= 1.2 && turn.confidence >= 0.4,
  );
  const memory = new Map<number, Association>();
  const decisions = new Map<
    Turn,
    Association & { method: "turn-mouth" | "identity-reuse" }
  >();
  for (const turn of sustained) {
    const wide = shotEvidence.filter(
      (shot) =>
        !shot.dominant && shot.start < turn.end && shot.end > turn.start,
    );
    const rows = wide
      .flatMap((shot) => shot.rows)
      .filter(
        (o) =>
          o.time >= turn.start &&
          o.time < turn.end &&
          !turns.some(
            (other) =>
              other.speaker !== turn.speaker &&
              o.time >= other.start &&
              o.time < other.end,
          ),
      );
    const sampleCount = new Set(rows.map((o) => o.time)).size;
    const scores = [...new Set(rows.map((o) => o.id))]
      .flatMap((id) => {
        const visible = rows.filter(
          (o) => o.id === id && o.face.mouth !== null,
        );
        if (visible.length < Math.max(8, sampleCount * 0.6)) return [];
        const mouths = visible.flatMap((o) =>
          o.face.mouth === null ? [] : [o.face.mouth],
        );
        const activity = mean(visible.map((o) => o.activity)),
          average = mean(mouths),
          variation = Math.sqrt(
            mean(mouths.map((value) => (value - average) ** 2)),
          );
        const quiet = wide
          .flatMap((shot) => shot.rows)
          .filter(
            (o) =>
              o.id === id &&
              sustained.some(
                (other) =>
                  other.speaker !== turn.speaker &&
                  o.time >= other.start &&
                  o.time < other.end,
              ),
          );
        const baseline = mean(quiet.map((o) => o.activity));
        if (
          activity < 0.009 ||
          variation < 0.02 ||
          (quiet.length >= 8 && activity < baseline * 1.2)
        )
          return [];
        return [
          {
            id,
            score: activity + variation * 0.2,
            coverage: visible.length / Math.max(1, sampleCount),
          },
        ];
      })
      .sort((a, b) => b.score - a.score);
    const best = scores[0],
      other = scores[1];
    // A solitary mouth score in a wide shot is insufficient if the other lips are obscured.
    const coVisibleIds = new Set(rows.map((o) => o.id));
    const measuredIds = new Set(
      [...coVisibleIds].filter(
        (id) =>
          rows.filter((o) => o.id === id && o.face.mouth !== null).length >=
          Math.max(8, sampleCount * 0.6),
      ),
    );
    const confident =
      best &&
      coVisibleIds.size >= 2 &&
      measuredIds.size === coVisibleIds.size &&
      (!other || best.score >= other.score * 1.5);
    const remembered = memory.get(turn.speaker);
    if (confident && best) {
      const competingVoice = [...memory].some(
        ([voice, association]) =>
          voice !== turn.speaker && association.id === best.id,
      );
      // Conflicts abstain instead of silently overwriting a previously learned identity.
      if (competingVoice || (remembered && remembered.id !== best.id)) continue;
      const separation = other ? 1 - other.score / best.score : 0.5;
      const confidence =
        Math.min(0.95, 0.7 + separation * 0.2 + 0.05 * best.coverage) *
        (0.95 + 0.05 * turn.confidence);
      const association = { id: best.id, confidence };
      memory.set(turn.speaker, association);
      decisions.set(turn, { ...association, method: "turn-mouth" });
    } else if (remembered) {
      decisions.set(turn, { ...remembered, method: "identity-reuse" });
    }
  }
  const framing: SpeakerFraming[] = [],
    located: Turn[] = [];
  const visibleAssociation = (
    shot: (typeof shotEvidence)[number],
    turn: Turn,
    start: number,
    end: number,
  ) => {
    const decision = decisions.get(turn),
      face = decision
        ? shot.faces.find((face) => face.id === decision.id)
        : undefined;
    if (!face || !decision) return null;
    const samples = shot.samples.filter(
      (sample) => sample.time >= start && sample.time < end,
    );
    const visible = shot.rows.filter(
      (o) => o.id === face.id && o.time >= start && o.time < end,
    );
    if (!samples.length || visible.length < samples.length * 0.65) return null;
    return { face, decision };
  };
  for (const shot of shotEvidence) {
    const start = shot.shot === 0 ? 0 : shot.start,
      end = Math.min(duration, shot.end);
    if (end <= start) continue;
    const edges = [
      ...new Set([
        start,
        end,
        ...turns
          .flatMap((turn) => [turn.start, turn.end])
          .filter((time) => time > start && time < end),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < edges.length; i++) {
      const a = edges[i - 1],
        b = edges[i],
        active = turns.filter((turn) => turn.start <= a && turn.end >= b);
      const turn = active.length === 1 ? active[0] : undefined;
      const association = turn ? visibleAssociation(shot, turn, a, b) : null;
      const fallback = {
        start: a,
        end: b,
        shot: shot.shot,
        method: "fallback",
        confidence: 0,
        face: null,
        faceId: null,
        speaker: turn?.speaker ?? null,
      } satisfies SpeakerFraming;
      const frame: SpeakerFraming = shot.dominant
        ? {
            ...fallback,
            method: "shot-dominant",
            confidence: shot.dominant.confidence,
            face: shot.dominant.face,
            faceId: shot.dominant.id,
          }
        : association
          ? {
              ...fallback,
              method: association.decision.method,
              confidence: association.decision.confidence,
              face: association.face.face,
              faceId: association.face.id,
            }
          : fallback;
      framing.push(frame);
    }
    for (const turn of turns) {
      const a = Math.max(start, turn.start),
        b = Math.min(end, turn.end);
      if (b <= a) continue;
      const overlaps = turns.some(
        (other) =>
          other !== turn &&
          other.speaker !== turn.speaker &&
          other.start < b &&
          other.end > a,
      );
      const association = overlaps
        ? null
        : visibleAssociation(shot, turn, a, b);
      located.push({
        ...turn,
        start: a,
        end: b,
        face: association?.face.face ?? null,
        confidence: association?.decision.confidence ?? 0,
      });
    }
  }
  // A container may have a few milliseconds of audio padding beyond its last video frame.
  const last = framing.at(-1);
  if (last && last.end < duration)
    framing.push({
      ...last,
      start: last.end,
      end: duration,
      method: "fallback",
      confidence: 0,
      face: null,
      faceId: null,
      speaker: null,
    });
  return {
    version: 2,
    start: 0,
    end: duration,
    identityScope: "window",
    turns: located.sort((a, b) => a.start - b.start),
    framing,
    focus: speakerFocus(framing, duration),
  };
}
