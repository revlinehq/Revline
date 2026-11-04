// What an agent recreating a reference has actually looked at. A whole-video readFrames returns the moments map
// (every place the picture changes); a moment counts as read once a dense read (10 or more frames a second) covered
// it. Scenes built over moments nobody read come back with those moments named, so the agent reads them before
// moving on instead of rebuilding a transition from a guess. Grids show motion but not looks: the strongest moments
// also need one look up close (a full-size single frame or a crop inside them) before they are built, for exact
// shapes, colors and type.

export type CoverageMoment = { start: number; end: number; kind?: string; peak?: number };
type Window = { start: number; end: number };

/** Frames a second at which a read shows a transition frame by frame. */
const DENSE_FPS = 10;
const EPSILON = .05;
/** The longest change that is one transition rather than a stretch of several beats. */
const SPLIT_MAX = 1.5;
/** Frames in one sheet at or below which each tile is about 790 px wide: a full-size look, not a grid. */
export const CLOSE_UP_FRAMES = 2;
/** How many of the strongest moments must be seen up close. */
const KEY_MOMENTS = 6;
const label = (moment: Window) => `${moment.start}-${moment.end}s`;

export class ReadCoverage {
  private moments = new Map<string, CoverageMoment[]>();
  private dense = new Map<string, Window[]>();
  private cuts = new Map<string, number[]>();
  private closeUps = new Map<string, number[]>();

  /** Use the same single-reference detection for visual and motion gates. */
  referenceAssetId() {
    const mapped = [...this.moments].filter(([, moments]) => moments.length);
    return mapped.length === 1 ? mapped[0][0] : undefined;
  }

  /** A reference's hard cuts (the starts of its measured shots after the first). */
  noteCuts(assetId: string, cuts: number[]) { this.cuts.set(assetId, cuts); }

  /** A readFrames result: its window, how densely it sampled, the moments it found, and the frame times it showed up
   * close (every frame of a crop, or a sheet of one or two frames). */
  noteRead(assetId: string, window: Window, framesPerSecond: number, moments: CoverageMoment[] = [], closeUp: number[] = []) {
    if (framesPerSecond >= DENSE_FPS) this.dense.set(assetId, [...this.dense.get(assetId) ?? [], window]);
    if (closeUp.length) this.closeUps.set(assetId, [...this.closeUps.get(assetId) ?? [], ...closeUp]);
    const known = this.moments.get(assetId) ?? [];
    for (const moment of moments) if (!known.some(item => Math.abs(item.start - moment.start) < EPSILON && Math.abs(item.end - moment.end) < EPSILON)) known.push(moment);
    this.moments.set(assetId, known.sort((a, b) => a.start - b.start));
  }

  /** Moments of an asset that run across one of its hard cuts: one continuous change, so one scene or a transition, never split at the cut. */
  acrossCuts(assetId: string, moments: CoverageMoment[]) {
    const cuts = this.cuts.get(assetId) ?? [];
    return moments.filter(moment => moment.kind !== 'cut' && cuts.some(cut => cut > moment.start + EPSILON && cut < moment.end - EPSILON));
  }

  /** Read when dense reads together cover it end to end: a long moment is usually read in several windows. */
  private read(assetId: string, moment: Window) {
    let reached = moment.start + EPSILON;
    for (const window of [...this.dense.get(assetId) ?? []].sort((a, b) => a.start - b.start)) if (window.start <= reached && window.end > reached) reached = window.end;
    return reached >= moment.end - EPSILON;
  }

  /** Seen up close when a close-up frame falls inside the moment. */
  private seenClose(assetId: string, moment: Window) {
    return (this.closeUps.get(assetId) ?? []).some(time => time >= moment.start - EPSILON && time <= moment.end + EPSILON);
  }

  /** The strongest moments of a reference, which carry its look and must be opened up close. */
  private keyMoments(moments: CoverageMoment[]) {
    return new Set([...moments].sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0)).slice(0, KEY_MOMENTS));
  }

  /** What a scene placed over [start, end] of the timeline still owes: unread moments there (the reference plays on the
   * same clock as its recreation) and cuts that split a moment at the scene's edges. Empty unless one reference is mapped. */
  sceneCheck(start: number, end: number) {
    const assetId = this.referenceAssetId();
    if (!assetId) return undefined;
    const moments = this.moments.get(assetId)!;
    const inside = moments.filter(moment => moment.end > start + EPSILON && moment.start < end - EPSILON);
    const unread = inside.filter(moment => !this.read(assetId, moment));
    const keys = this.keyMoments(moments), unseen = inside.filter(moment => keys.has(moment) && !this.seenClose(assetId, moment));
    // A scene edge inside a transition cuts one continuous change in two. Long stretches of motion are many beats, and
    // scenes rightly end inside them, so only a short change (a transition) counts as split.
    const split = inside.filter(moment => moment.end - moment.start <= SPLIT_MAX && [start, end].some(edge => edge > moment.start + EPSILON && edge < moment.end - EPSILON));
    if (!unread.length && !split.length && !unseen.length) return undefined;
    return {
      ...(unread.length ? { unreadMoments: unread.map(label) } : {}),
      ...(unseen.length ? { unseenMoments: unseen.map(label) } : {}),
      ...(split.length ? { splitMoments: split.map(label) } : {}),
      readCheck: [
        unread.length ? `This scene covers ${unread.length} reference moment${unread.length === 1 ? '' : 's'} never read frame by frame (${unread.map(label).join(', ')}): read each with readFrames fps 10 now and fix the scene to match before building the next one.` : '',
        unseen.length ? `Never seen up close: ${unseen.map(label).join(', ')}. Open one full frame (readFrames count 1 at that second) or a crop inside each before building it, to get shapes, colors and type exactly.` : '',
        split.length ? `This scene's edge cuts through ${split.map(label).join(', ')}: that change is continuous in the reference, so keep it inside one scene or make it a transition clip.` : '',
      ].filter(Boolean).join(' '),
    };
  }
}
