import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { seatedRenders } from './lib/render_seats';

const LANES = ['ultra', 'standard'] satisfies Array<'ultra' | 'standard'>;

export const processingDemand = internalQuery({ args: {}, returns: v.object({ waiting: v.number(), running: v.number() }), handler: async ctx => {
  const waiting = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created', q => q.eq('status', 'queued').eq('claimable', true))
    .filter(q => q.and(q.neq(q.field('kind'), 'render'), q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION)))).take(8);
  const legacy = waiting.length < 8 ? await ctx.db.query('mediaTasks').withIndex('by_status_createdAt', q => q.eq('status', 'queued'))
    .filter(q => q.and(q.eq(q.field('claimable'), undefined), q.gt(q.field('attempt'), 0), q.neq(q.field('workflowId'), undefined), q.neq(q.field('kind'), 'render'), q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION)))).take(8 - waiting.length) : [];
  const running = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_created', q => q.eq('status', 'running').eq('claimable', false))
    .filter(q => q.neq(q.field('kind'), 'render')).take(100);
  return { waiting: waiting.length + legacy.length, running: running.length };
} });

export const exportDemand = internalQuery({ args: {}, returns: v.object({ ultra: v.object({ waiting: v.number(), running: v.number() }), standard: v.object({ waiting: v.number(), running: v.number() }) }), handler: async ctx => {
  const versioned = (q: import('convex/server').FilterBuilder<import('convex/server').GenericTableInfo>) => q.or(q.eq(q.field('requiredProcessorVersion'), undefined), q.lte(q.field('requiredProcessorVersion'), MEDIA_PROCESSOR_VERSION));
  const running = await ctx.db.query('mediaTasks').withIndex('by_status_claimable_kind_created', q => q.eq('status', 'running').eq('claimable', false).eq('kind', 'render')).take(200);
  const result = { ultra: { waiting: 0, running: 0 }, standard: { waiting: 0, running: 0 } };
  for (const lane of LANES) {
    result[lane].waiting = (await seatedRenders(ctx, lane === 'ultra' ? 'ultra' : undefined, versioned, 100)).length;
    result[lane].running = running.filter(task => (task.lane === 'ultra') === (lane === 'ultra')).length;
  }
  return result;
}});
