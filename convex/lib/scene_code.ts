import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { sceneCodeRefs, withoutSceneCode, withSceneCode } from '../../lib/editor/scene-code';
import type { Timeline } from '../../lib/editor/types';

type Clips = Pick<Timeline, 'clips'>;

/** Code rows a stored timeline already points at. Rows are never deleted, so these need no lookup. */
export function storedSceneCode(...timelines: (Clips | null | undefined)[]) {
  return new Set(timelines.flatMap(timeline => timeline ? sceneCodeRefs(timeline) : []));
}

// Code this mutation already saved or found, so later writes in it skip the lookup.
const saved = new WeakMap<object, Set<string>>();
/** The stored form of a timeline: scene code saved to sceneCode rows, referenced by hash. */
export async function storeSceneCode<T extends Clips>(ctx: MutationCtx, timeline: T, known: Set<string> = new Set()): Promise<T> {
  const { timeline: stored, code } = await withoutSceneCode(timeline);
  const seen = saved.get(ctx.db) ?? new Set<string>();saved.set(ctx.db, seen);
  for (const [hash, text] of code) {
    if (known.has(hash) || seen.has(hash)) continue;
    if (!await ctx.db.query('sceneCode').withIndex('by_hash', q => q.eq('hash', hash)).first()) await ctx.db.insert('sceneCode', { hash, code: text });
    seen.add(hash);
  }
  return stored;
}

export async function sceneCodeText(ctx: QueryCtx, hash: string) {
  return (await ctx.db.query('sceneCode').withIndex('by_hash', q => q.eq('hash', hash)).first())?.code ?? null;
}

/** A stored timeline with its scene code restored, for editing, validation, tools and exports. */
export async function loadSceneCode<T extends Clips>(ctx: QueryCtx, timeline: T): Promise<T> {
  const refs = sceneCodeRefs(timeline);
  if (!refs.length) return timeline;
  const code = new Map(await Promise.all(refs.map(async hash => [hash, await sceneCodeText(ctx, hash)] as const)));
  const restored = withSceneCode(timeline, hash => code.get(hash));
  if (!restored) throw new ConvexError('Scene code is unavailable.');
  return restored;
}
