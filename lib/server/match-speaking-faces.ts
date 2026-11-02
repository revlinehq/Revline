import type { SpeakerAnalysis } from '../media-analysis/clipping';
import type { Transcript } from '../media-analysis/transcript';
import type { SourceFaceEvidence } from './source-face-evidence';

type Face = Omit<SourceFaceEvidence['samples'][number]['faces'][number], 'mouth'> & { mouth: number };
type Turn = SpeakerAnalysis['turns'][number];
type Observation = { id: number; time: number; face: Face; activity: number };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Correlate articulation with audio identities, abstaining on weak or competing evidence. */
export function matchSpeakingFaces(evidence: SourceFaceEvidence, transcript: Transcript, turns: Turn[]): { turns: Turn[]; tracked: SpeakerAnalysis['focus'] } {
  const observations: Observation[] = [], latest = new Map<number, Observation>();
  let nextId = 0;
  for (const sample of evidence.samples) {
    const used = new Set<number>();
    for (const face of sample.faces) {
      if (face.mouth === null) continue;
      const candidates = [...latest.values()].filter(o => !used.has(o.id) && sample.time - o.time <= .6 && o.face.w / face.w > .5 && o.face.w / face.w < 2)
        .map(o => ({ observation: o, distance: Math.hypot(o.face.x + o.face.w / 2 - face.x - face.w / 2, o.face.y + o.face.h / 2 - face.y - face.h / 2) })).sort((a, b) => a.distance - b.distance);
      const previous = candidates[0]?.distance < .12 ? candidates[0].observation : undefined;
      const id = previous?.id ?? nextId++;
      used.add(id);
      const delta = previous && sample.time - previous.time < .25 ? Math.abs(face.mouth - previous.face.mouth) : 0;
      const observation = { id, time: sample.time, face: { ...face, mouth: face.mouth }, activity: Math.max(0, delta - .01) + Math.max(0, face.mouth - .05) * .15 };
      observations.push(observation); latest.set(id, observation);
    }
  }
  const sustained = turns.filter(t => t.end - t.start >= .8);
  const words = transcript.words.filter(w => sustained.some(t => t.speaker === w.speaker && w.start >= t.start && w.end <= t.end + .001));
  const speakers = [...new Set(sustained.map(t => t.speaker))];
  const scores = speakers.flatMap(speaker => [...latest.keys()].flatMap(id => {
    const on: number[] = [], off: number[] = [];
    for (const o of observations.filter(o => o.id === id)) {
      const aligned = words.filter(w => o.time >= w.start - .05 && o.time <= w.end + .05);
      if (new Set(aligned.map(w => w.speaker)).size > 1) continue;
      (aligned[0]?.speaker === speaker ? on : off).push(o.activity);
    }
    if (on.length < 8 || off.length < 8) return [];
    const active = mean(on), quiet = mean(off), contrast = (active - quiet) / (active + quiet + .005);
    if (active < .008 || contrast < .12) return [];
    return [{ speaker, id, score: contrast, count: on.length }];
  }));
  const matches = new Map<number, { speaker: number; confidence: number; score: number }>();
  for (const id of latest.keys()) {
    const ranked = scores.filter(s => s.id === id).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score - (ranked[1]?.score ?? 0) < .12) continue;
    matches.set(id, { speaker: best.speaker, confidence: Math.min(.95, .7 + .25 * best.score), score: best.score });
  }
  const tracked: SpeakerAnalysis['focus'] = [];
  const located = turns.map(turn => {
    if (turn.end - turn.start < .8) return { ...turn, face: null, confidence: 0 };
    const candidates = [...latest.keys()].flatMap(id => {
      const visible = observations.filter(o => o.id === id && o.time >= turn.start && o.time < turn.end);
      if (visible.length < Math.max(4, (turn.end - turn.start) * 4)) return [];
      const active = visible.filter(o => words.some(w => w.speaker === turn.speaker && o.time >= w.start - .05 && o.time <= w.end + .05));
      if (active.length < 4) return [];
      const activity = mean(active.map(o => o.activity)), mouth = active.map(o => o.face.mouth);
      const variation = Math.sqrt(mean(mouth.map(m => (m - mean(mouth)) ** 2)));
      const association = matches.get(id);
      if ((association && association.speaker !== turn.speaker) || activity < .012 || variation < .025) return [];
      return [{ id, activity, visible, confidence: association?.confidence ?? .75 }];
    }).sort((a, b) => b.activity - a.activity);
    const best = candidates[0], other = candidates[1];
    // Compare co-visible articulation, never face size. A sole face needs word/pause evidence.
    if (!best || other && best.activity < other.activity * 1.5 || !other && !matches.has(best.id)) return { ...turn, face: null, confidence: 0 };
    const frames = new Map<number, { observation: Observation; confidence: number; score: number }[]>();
    for (const o of observations) {
      const association = matches.get(o.id);
      if (o.time < turn.start || o.time >= turn.end) continue;
      if (o.id !== best.id && association?.speaker !== turn.speaker) continue;
      const row = frames.get(o.time) ?? [];
      const score = o.id === best.id ? 1 : association?.score ?? 0;
      row.push({ observation: o, confidence: association?.confidence ?? best.confidence, score }); frames.set(o.time, row);
    }
    const visible = [...frames.values()].flatMap(row => {
      row.sort((a, b) => b.score - a.score);
      return row[0].score - (row[1]?.score ?? 0) >= .12 ? [row[0]] : [];
    }).sort((a, b) => a.observation.time - b.observation.time);
    if (visible.length < Math.max(4, (turn.end - turn.start) * 4)) return { ...turn, face: null, confidence: 0 };
    const confidence = mean(visible.map(o => o.confidence)) * (.9 + .1 * turn.confidence);
    if (confidence < .7) return { ...turn, face: null, confidence };
    for (const { observation: o } of visible) if (!turns.some(t => t.speaker !== turn.speaker && o.time >= t.start && o.time < t.end)) tracked.push({ time: o.time, x: o.face.x + o.face.w / 2, y: o.face.y + o.face.h / 2 });
    const first = visible[0].observation.face;
    return { ...turn, face: { x: first.x, y: first.y, w: first.w, h: first.h }, confidence };
  });
  return { turns: located, tracked: tracked.sort((a, b) => a.time - b.time) };
}
