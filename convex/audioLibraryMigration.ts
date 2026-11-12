import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { isStockAudioKey } from '../lib/editor/stock-audio';
import { ownedObjectReferences, setStorageObjectListed } from './lib/storage_accounting';

// Names the editor gives audio it writes straight to storage, with no upload lease.
const GENERATED_NAMES = [/^Music bed \d+ BPM .+\.wav$/, / \(Mixkit\)\.mp3$/, /^Normalized social mix\.wav$/];

/** Audio rows from before `libraryHidden` that the editor clearly made by itself: a catalog sound, a generated sound,
 *  the audio extracted from a video, or audio a media task (extraction, loudness normalization) uploaded. */
async function madeAutomatically(ctx: MutationCtx, asset: Doc<'assets'>) {
  if (asset.kind !== 'audio') return false;
  if (asset.libraryHidden !== undefined) return asset.libraryHidden;
  if (isStockAudioKey(asset.r2Key) || asset.soundRecipe !== undefined) return true;
  if (await ctx.db.query('assets').withIndex('by_owner_audio', q => q.eq('ownerId', asset.ownerId).eq('audioAssetId', asset._id)).first()) return true;
  if (!asset.r2Key) return false;
  const leases = await ctx.db.query('r2Uploads').withIndex('by_projectId_completed', q => q.eq('projectId', asset.projectId).eq('completed', true)).take(500);
  const lease = leases.find(item => item.assetId === asset._id);
  // A user upload has a lease without a task; only audio with no lease at all is matched by name.
  if (lease) return !!lease.taskId;
  return GENERATED_NAMES.some(name => name.test(asset.fileName));
}

/** One-time backfill, run by the operator after deploy and continuing itself page by page:
 *  `npx convex run audioLibraryMigration:hideAutoAudio '{"cursor":null}'`. Marks such rows hidden and unlists their
 *  stored file from the Library when no other copy of it is a normal file; bytes stay counted. Rows already marked
 *  either way are left alone. */
export const hideAutoAudio = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ hidden: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    // Small pages: older asset rows can still carry their analysis inline.
    const page = await ctx.db.query('assets').paginate({ cursor: args.cursor, numItems: 20 });
    let hidden = 0;
    for (const asset of page.page) {
      if (asset.kind !== 'audio' || asset.libraryHidden !== undefined || !await madeAutomatically(ctx, asset)) continue;
      await ctx.db.patch(asset._id, { libraryHidden: true });
      hidden++;
      const refs = await ownedObjectReferences(ctx, asset.ownerId, asset);
      if (refs.library || refs.tooMany) continue;
      let shared = false;
      for (const other of refs.attachments) if (other._id !== asset._id && !await madeAutomatically(ctx, other)) { shared = true; break; }
      if (!shared) await setStorageObjectListed(ctx, asset.ownerId, asset, false);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.audioLibraryMigration.hideAutoAudio, { cursor: page.continueCursor });
    return { hidden, done: page.isDone };
  },
});
