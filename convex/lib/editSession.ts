import { normalizeTimeline, type Timeline } from '../../lib/editor/types';
import { rebaseNonDestructiveEdit } from './editSessionRebase';

export const isTimelineConflict = (error: unknown) => /timeline changed elsewhere/i.test(error instanceof Error ? error.message : String(error));

type EditStorage = {
  apply: (timeline: Timeline, revision: number, publication?:boolean) => Promise<number>;
  validate: (timeline: Timeline, revision: number) => Promise<unknown>;
  refresh?: () => Promise<{ timeline: Timeline; revision: number }>;
  beforeChange?: () => Promise<unknown>;
};

const sourcePlacementFields = ['assetId', 'kind', 'start', 'duration', 'sourceStart', 'playbackRate', 'track'] as const;

/** One serialized model turn. Source edits and clip replacements remain private until completion. */
export class EditSession {
  timeline: Timeline;
  revision: number;
  savedEdits = 0;
  staged = false;
  private pending: Promise<unknown> = Promise.resolve();
  private failed = false;
  private needsInspection = false;

  constructor(timeline: Timeline, revision: number, private storage: EditStorage, private signal?: AbortSignal) {
    this.timeline = normalizeTimeline(timeline);
    this.revision = revision;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => { this.signal?.throwIfAborted(); return operation(); });
    this.pending = result.catch(error => { if (this.staged) this.failed = true; if (isTimelineConflict(error)) this.needsInspection = true; });
    return result;
  }

  wait() { return this.pending; }

  checkpoint(edit: (timeline: Timeline) => Timeline) {
    return this.enqueue(async () => {
      if (this.needsInspection) throw new Error('The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
      let previous = this.timeline;
      let next = normalizeTimeline(edit(previous));
      if (next === previous || JSON.stringify(next) === JSON.stringify(previous)) return { applied: false, saved: false, staged: this.staged, unchanged: true, revision: this.revision, changedClips: [], removedClipIds: [], removedMarkerIds: [], aspectRatio: previous.aspectRatio };
      await this.storage.beforeChange?.();
      const nextById = new Map(next.clips.map(clip => [clip.id, clip]));
      const removedClipIds = previous.clips.filter(clip => !nextById.has(clip.id)).map(clip => clip.id);
      const sourceChanged = previous.clips.some(clip => {
        if (clip.kind !== 'video' && clip.kind !== 'audio' && clip.kind !== 'image') return false;
        const current = nextById.get(clip.id);
        return current && sourcePlacementFields.some(field => clip[field] !== current[field]);
      });
      const remainingMarkerIds = new Set(next.markers?.map(marker => marker.id));
      const removedMarkerIds = (previous.markers ?? []).filter(marker => !remainingMarkerIds.has(marker.id)).map(marker => marker.id);
      // Splits preserve the original IDs, and trims/moves can temporarily leave gaps.
      // Stage the first source change, not just its later deletion/replacement.
      this.staged ||= removedClipIds.length > 0 || sourceChanged;
      if (this.staged) await this.storage.validate(next, this.revision);
      else {
        try { this.revision = await this.storage.apply(next, this.revision); }
        catch (error) {
          if (!isTimelineConflict(error) || !this.storage.refresh) throw error;
          const fresh = await this.storage.refresh();
          this.timeline = normalizeTimeline(fresh.timeline); this.revision = fresh.revision;
          try {
            next = rebaseNonDestructiveEdit(previous, next, this.timeline); previous = this.timeline;
            if (JSON.stringify(next) === JSON.stringify(previous)) return { applied:false, saved:false, staged:false, unchanged:true, revision:this.revision, changedClips:[], removedClipIds:[], removedMarkerIds:[], aspectRatio:previous.aspectRatio };
            this.revision = await this.storage.apply(next, this.revision);
          } catch (retryError) {
            if (isTimelineConflict(retryError)) this.needsInspection = true;
            throw retryError;
          }
        }
        this.savedEdits++;
      }
      this.timeline = next;
      const changedClips = next.clips.filter(clip => JSON.stringify(clip) !== JSON.stringify(previous.clips.find(current => current.id === clip.id))).map(({ id, kind, track, start, duration, sourceStart, text, transform, crop, fit }) => ({ id, kind, ...(transform ? { transform } : {}), ...(crop ? { crop } : {}), ...(fit ? { fit } : {}), ...(track ? { track } : {}), start, duration, sourceStart, ...(text ? { text: text.slice(0, 120) } : {}) }));
      return { applied: !this.staged, saved: !this.staged, staged: this.staged, revision: this.revision, changedClips, removedClipIds, removedMarkerIds, aspectRatio: next.aspectRatio };
    });
  }

  inspect(read: () => Promise<{ timeline: Timeline; revision: number }>) {
    return this.enqueue(async () => {
      const current = await read();
      if (this.staged) {
        if (current.revision !== this.revision) throw new Error('The timeline changed elsewhere. Your replacement was not saved.');
      } else {
        this.timeline = normalizeTimeline(current.timeline);
        this.revision = current.revision;
        this.needsInspection = false;
      }
      return { timeline: this.timeline, revision: this.revision, staged: this.staged };
    });
  }

  async complete(finishReason: string, toolFailed = false) {
    await this.pending;
    this.signal?.throwIfAborted();
    if (finishReason !== 'stop') throw new Error('The assistant stopped before finishing this request. The pending replacement was not saved.');
    if (!this.staged) {
      if (this.needsInspection || toolFailed) throw new Error('Some requested changes were not saved. Inspect the current timeline before continuing; previously saved edits remain.');
      return false;
    }
    if (this.failed || toolFailed) throw new Error('A tool could not complete. The pending replacement was not saved.');
    this.revision = await this.storage.apply(this.timeline, this.revision,true);
    this.savedEdits++;
    this.staged = false;
    return true;
  }
}
