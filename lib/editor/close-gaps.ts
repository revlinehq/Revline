import { deriveTrackCounts, layerGroup, maxTrackCount, trackOf, type Clip, type Timeline } from './types';
import { reconcileTransitionEdits } from './clip-transitions';

const media = (clip: Clip) => clip.kind === 'video' || clip.kind === 'image';
const overlaps = (a: Clip, b: Clip) => a.start < b.start + b.duration - 1e-6 && b.start < a.start + a.duration - 1e-6;

/** Close footage gaps without changing retained source ranges or linked audio sync: every gap on every
 * visual layer in one change (also gaps shorter than a frame), or only between the selected clips. */
export function closeFootageGaps(timeline: Timeline, selectedIds: readonly string[] = [], onlyTracks?: readonly number[]): Timeline {
  const selected = new Set(selectedIds);
  for (const clip of timeline.clips) if (clip.kind === 'audio' && selected.has(clip.id) && clip.linkedClipId) selected.add(clip.linkedClipId);
  const selectedMedia = timeline.clips.filter(clip => media(clip) && selected.has(clip.id));
  const selectionOnly = selectedMedia.length > 1;
  // `onlyTracks` keeps the join to the named layers: sparse overlay layers are placed by time and must not be packed.
  const tracks = new Set(timeline.clips.filter(clip => media(clip) && (!selectionOnly || selected.has(clip.id))).map(trackOf).filter(track => selectionOnly || !onlyTracks || onlyTracks.includes(track)));
  const offsets = new Map<string, number>();
  const byId = new Map(timeline.clips.map(clip => [clip.id, clip]));
  for (const track of tracks) {
    const row = timeline.clips.filter(clip => layerGroup(clip.kind) === 'visual' && trackOf(clip) === track).sort((a, b) => a.start - b.start);
    let end = 0, anchored = !selectionOnly;
    for (const clip of row) {
      const included = !selectionOnly || selected.has(clip.id) && media(clip);
      if (included && !anchored) { end = clip.start; anchored = true; }
      const start = included ? Math.min(clip.start, end) : clip.start;
      if (Math.abs(start - clip.start) > 1e-6) {
        const delta = start - clip.start;
        offsets.set(clip.id, delta);
        const linked = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
        if (linked?.kind === 'audio' && linked.linkedClipId === clip.id) offsets.set(linked.id, delta);
      }
      end = Math.max(end, start + clip.duration);
    }
  }
  if (!offsets.size) return timeline;
  let clips = timeline.clips.map(clip => offsets.has(clip.id) ? { ...clip, start: clip.start + offsets.get(clip.id)! } : clip);
  // A music bed or another linked pair may occupy the audio destination. Keep
  // those clips intact and give only the moved linked audio a free A track.
  for (const clip of clips.filter(clip => clip.kind === 'audio' && offsets.has(clip.id))) {
    const free = (track: number) => !clips.some(other => other.id !== clip.id && other.kind === 'audio' && trackOf(other) === track && overlaps(clip, other));
    if (free(trackOf(clip))) continue;
    const track = Array.from({ length: maxTrackCount('audio') }, (_, index) => index + 1).find(free);
    if (!track) throw new Error('No free audio track is available to close these gaps.');
    clips = clips.map(other => other.id === clip.id ? { ...other, track } : other);
  }
  // Reconcile once, after both ends move, so existing transitions keep their cut.
  const next = reconcileTransitionEdits(timeline, { ...timeline, clips });
  return { ...next, tracks: deriveTrackCounts(next) };
}
