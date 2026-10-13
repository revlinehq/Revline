import { normalizeTimeline, type Timeline } from '../../lib/editor/types';

type EditStorage = {
  apply: (timeline: Timeline, revision: number) => Promise<number>;
  validate: (timeline: Timeline, revision: number) => Promise<unknown>;
};

/** One serialized model turn. Clip replacements remain private until completion. */
export class EditSession {
  timeline: Timeline;
  revision: number;
  savedEdits = 0;
  staged = false;
  private pending: Promise<unknown> = Promise.resolve();
  private failed = false;

  constructor(timeline: Timeline, revision: number, private storage: EditStorage, private signal?: AbortSignal) {
    this.timeline = normalizeTimeline(timeline);
    this.revision = revision;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => { this.signal?.throwIfAborted(); return operation(); });
    this.pending = result.catch(() => { if (this.staged) this.failed = true; });
    return result;
  }

  wait() { return this.pending; }

  checkpoint(edit: (timeline: Timeline) => Timeline) {
    return this.enqueue(async () => {
      const previous = this.timeline;
      const next = normalizeTimeline(edit(previous));
      if (next === previous) return { applied: false, saved: false, staged: this.staged, unchanged: true, revision: this.revision, changedClips: [], removedClipIds: [], aspectRatio: previous.aspectRatio };
      const removedClipIds = previous.clips.filter(clip => !next.clips.some(current => current.id === clip.id)).map(clip => clip.id);
      this.staged ||= removedClipIds.length > 0;
      if (this.staged) await this.storage.validate(next, this.revision);
      else {
        this.revision = await this.storage.apply(next, this.revision);
        this.savedEdits++;
      }
      this.timeline = next;
      const changedClips = next.clips.filter(clip => JSON.stringify(clip) !== JSON.stringify(previous.clips.find(current => current.id === clip.id))).map(({ id, kind, track, start, duration, sourceStart, text, transform, crop, fit }) => ({ id, kind, ...(transform ? { transform } : {}), ...(crop ? { crop } : {}), ...(fit ? { fit } : {}), ...(track ? { track } : {}), start, duration, sourceStart, ...(text ? { text: text.slice(0, 120) } : {}) }));
      return { applied: !this.staged, saved: !this.staged, staged: this.staged, revision: this.revision, changedClips, removedClipIds, aspectRatio: next.aspectRatio };
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
      }
      return { timeline: this.timeline, revision: this.revision, staged: this.staged };
    });
  }

  async complete(finishReason: string, toolFailed = false) {
    await this.pending;
    this.signal?.throwIfAborted();
    if (finishReason !== 'stop') throw new Error('Claude stopped before finishing this request. The pending replacement was not saved.');
    if (!this.staged) return false;
    if (this.failed || toolFailed) throw new Error('A tool could not complete. The pending replacement was not saved.');
    this.revision = await this.storage.apply(this.timeline, this.revision);
    this.savedEdits++;
    this.staged = false;
    return true;
  }
}
