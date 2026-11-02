import {EDITOR_SOFT_STEPS,EDITOR_HARD_STEPS} from '../../lib/ai/edit-progress';
import { normalizeTimeline, type Timeline } from '../../lib/editor/types';
import { rebaseNonDestructiveEdit } from './editSessionRebase';
import { isApprovalRejection, isOverlapPlacementRejection, type TimelineGestureRejection } from '../../lib/editor/timeline-edit-errors';

export const isTimelineConflict = (error: unknown) => /timeline changed elsewhere/i.test(error instanceof Error ? error.message : String(error));
export class IncompleteEditError extends Error {
  constructor(readonly reason: 'step_limit' | 'output_limit' | 'incomplete', staged: boolean, savedEdits: number, steps = 0) {
    const cause = reason === 'step_limit' ? steps >= EDITOR_HARD_STEPS ? 'This request reached its editing step limit before finishing.' : 'The request paused because recent steps made no new timeline changes.' : reason === 'output_limit' ? 'This request reached the model output limit before finishing.' : 'The assistant stopped before finishing this request.';
    super(`${cause} ${staged ? 'The pending replacement was not saved.' : savedEdits ? 'Your saved changes remain. Continue the unfinished part from the current timeline.' : 'No timeline changes were saved.'}`);
    this.name = 'IncompleteEditError';
  }
}

type EditStorage = {
  apply: (timeline: Timeline, revision: number, publication?:boolean) => Promise<number>;
  validate: (timeline: Timeline, revision: number) => Promise<unknown>;
  refresh?: () => Promise<{ timeline: Timeline; revision: number }>;
  beforeChange?: () => Promise<unknown>;
};

const sourcePlacementFields = ['assetId', 'kind', 'start', 'duration', 'sourceStart', 'playbackRate', 'track'] as const;

/** One serialized model turn. Source edits stay private until publication. */
export class EditSession {
  timeline: Timeline;
  revision: number;
  savedEdits = 0;
  staged = false;
  private pending: Promise<unknown> = Promise.resolve();
  private failed = false;
  private needsInspection = false;
  private stagedEdits = 0;

  constructor(timeline: Timeline, revision: number, private storage: EditStorage, private signal?: AbortSignal) {
    this.timeline = normalizeTimeline(timeline);
    this.revision = revision;
  }

  private enqueue<T>(operation: () => Promise<T>, rejectedBeforeChange?: (error: unknown) => boolean): Promise<T> {
    const result = this.pending.then(() => { this.signal?.throwIfAborted(); return operation(); });
    this.pending = result.catch(error => { if (this.staged && !rejectedBeforeChange?.(error)) this.failed = true; if (isTimelineConflict(error)) this.needsInspection = true; });
    return result;
  }

  wait() { return this.pending; }

  restoreDraft(timeline:Timeline) {
    this.timeline=normalizeTimeline(timeline);
    this.staged=true;
    this.stagedEdits=1;
  }

  /** Only used after the tool layer recovered an atomic receipt or a direct mutation's save. */
  async reconcileSaved(read: () => Promise<{ timeline: Timeline; revision: number }>,force=false) {
    await this.pending;
    const current = await read();
    if (!force&&current.revision <= this.revision) return;
    const advanced=current.revision>this.revision;
    this.timeline = normalizeTimeline(current.timeline);
    this.revision = current.revision;
    if(advanced)this.savedEdits++;
    this.staged = false;
    this.stagedEdits = 0;
    this.failed = false;
    this.needsInspection = false;
  }

  private async publishCurrentTimeline() {
    if (this.failed || this.needsInspection) throw new Error('Resolve the current timeline errors before publishing it or opening another timeline.');
    if (!this.staged) return;
    this.revision = await this.storage.apply(this.timeline, this.revision, true);
    this.savedEdits++;
    this.staged = false;
    this.stagedEdits = 0;
  }

  publish() { return this.enqueue(() => this.publishCurrentTimeline()); }

  /** Publish the current tab before replacing this session's working timeline. */
  switchTimeline(open: (revision: number) => Promise<{ timeline: Timeline; revision: number; timelineId: string }>) {
    return this.enqueue(async () => {
      await this.publishCurrentTimeline();
      const opened = await open(this.revision);
      const timelineChanged = opened.revision !== this.revision;
      this.timeline = normalizeTimeline(opened.timeline);
      this.revision = opened.revision;
      if (timelineChanged) this.savedEdits++;
      return { timelineId: opened.timelineId, opened: true, timelineChanged, revision: this.revision, saved: timelineChanged };
    });
  }

  checkpoint(edit: (timeline: Timeline) => Timeline) {
    let preflightRejection: TimelineGestureRejection | undefined;
    return this.enqueue(async () => {
      if (this.needsInspection) throw new Error('The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
      let previous = this.timeline;
      let edited: Timeline;
      try { edited = edit(previous); }
      catch (error) {
        // Only the pure placement and approval checks can reject without changing the
        // draft. A similarly named storage/validation failure still poisons it.
        if (isOverlapPlacementRejection(error) || isApprovalRejection(error)) preflightRejection = error;
        throw error;
      }
      let next = normalizeTimeline(edited);
      if (next === previous || JSON.stringify(next) === JSON.stringify(previous)) return { applied: false, saved: false, staged: this.staged, unchanged: true, revision: this.revision, changedClips: [], removedClipIds: [], removedMarkerIds: [], aspectRatio: previous.aspectRatio };
      await this.storage.beforeChange?.();
      const nextById = new Map(next.clips.map(clip => [clip.id, clip]));
      const removedClipIds = previous.clips.filter(clip => !nextById.has(clip.id)).map(clip => clip.id);
      const sourceChanged = previous.clips.some(clip => {
        if (clip.kind !== 'video' && clip.kind !== 'audio' && clip.kind !== 'image') return false;
        const current = nextById.get(clip.id);
        return current && sourcePlacementFields.some(field => clip[field] !== current[field]);
      });
      const previousMarkers=new Map((previous.markers??[]).map(marker=>[marker.id,marker]));
      const changedMarkerIds=(next.markers??[]).filter(marker=>JSON.stringify(marker)!==JSON.stringify(previousMarkers.get(marker.id))).map(marker=>marker.id);
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
      if (this.staged) this.stagedEdits++;
      const changedClips = next.clips.filter(clip => JSON.stringify(clip) !== JSON.stringify(previous.clips.find(current => current.id === clip.id))).map(({ id, kind, track, start, duration, sourceStart, text, transform, crop, fit }) => ({ id, kind, ...(transform ? { transform } : {}), ...(crop ? { crop } : {}), ...(fit ? { fit } : {}), ...(track ? { track } : {}), start, duration, sourceStart, ...(text ? { text: text.slice(0, 120) } : {}) }));
      return { applied: !this.staged, saved: !this.staged, staged: this.staged, revision: this.revision, changedClips, removedClipIds, removedMarkerIds, changedMarkerIds, aspectRatio: next.aspectRatio };
    }, error => preflightRejection !== undefined && error === preflightRejection);
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

  /** Only the orchestrator calls this after all recorded tool failures resolve.
   * A failed operation never assigned its candidate to timeline. Revalidate the
   * latest successful checkpoint before releasing the failed-draft guard. */
  async confirmRepairs() {
    await this.pending;
    this.signal?.throwIfAborted();
    if (this.needsInspection) throw new Error('The timeline changed elsewhere. Inspect the refreshed timeline before continuing.');
    if (this.failed) {
      await this.storage.validate(this.timeline, this.revision);
      this.failed = false;
    }
  }

  async complete(finishReason: string, toolFailed = false, steps = 0) {
    await this.pending;
    this.signal?.throwIfAborted();
    if (finishReason !== 'stop') {
      await this.savePartial();
      throw new IncompleteEditError(finishReason === 'tool-calls' && steps >= EDITOR_SOFT_STEPS ? 'step_limit' : finishReason === 'length' ? 'output_limit' : 'incomplete', this.staged, this.savedEdits, steps);
    }
    if (!this.staged) {
      if (this.needsInspection || toolFailed) throw new Error('Some requested changes were not saved. Inspect the current timeline before continuing; previously saved edits remain.');
      return false;
    }
    if (this.failed || toolFailed) throw new Error('A tool could not complete. The pending replacement was not saved.');
    this.revision = await this.storage.apply(this.timeline, this.revision,true);
    this.savedEdits++;
    this.staged = false;
    this.stagedEdits = 0;
    return true;
  }

  /** Preserve only the latest successful checkpoint, never an operation that
   * threw before assigning this.timeline. Storage rechecks ownership, active
   * run, source validity and revision atomically with its publication receipt.
   * A time-budget abort may reach here; an explicit Stop invalidates the run
   * in storage and therefore still refuses late writes. */
  async savePartial() {
    await this.pending;
    if (!this.staged || !this.stagedEdits || this.needsInspection) return false;
    await this.storage.validate(this.timeline, this.revision);
    this.revision = await this.storage.apply(this.timeline, this.revision, true);
    this.savedEdits++;
    this.staged = false;
    this.stagedEdits = 0;
    return true;
  }
}
