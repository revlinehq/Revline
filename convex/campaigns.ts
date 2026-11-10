// Campaigns as users see them: read the shared campaign data, keep a personal My campaigns list, and attach a
// project to a campaign. "My campaigns" is Revline's own list (saved, or a project attached); it says nothing
// about having joined a campaign on Content Rewards. Search and project matching live in campaignsSearch.ts.
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { EMBEDDING_DIMENSIONS, campaignFilters, campaignView, passesFilters, viewOf } from './campaignsModel';
import { fingerprint } from '../lib/campaigns/score';

export { campaignIdValidator, type CampaignId } from './campaignsModel';

const projectLink = (ctx: QueryCtx | MutationCtx, projectId: Id<'projects'>) => ctx.db.query('projectCampaigns').withIndex('by_project', q => q.eq('projectId', projectId)).unique();

/** One campaign. Shared data: any signed-in user may read it. */
export const get = query({ args: { campaignId: v.id('campaigns') }, returns: v.union(campaignView, v.null()), handler: async (ctx, { campaignId }) => {
  await requireOwner(ctx);
  const campaign = await ctx.db.get(campaignId);
  return campaign ? viewOf(campaign) : null;
} });

/** The content types, categories and platforms stored campaigns use, for search filters. */
export const facets = query({ args: {}, returns: v.object({ contentTypes: v.array(v.object({ id: v.string(), name: v.string() })), categories: v.array(v.object({ id: v.string(), name: v.string() })), platforms: v.array(v.string()) }), handler: async ctx => {
  await requireOwner(ctx);
  const rows = await ctx.db.query('campaignFacets').take(500);
  const of = (kind: Doc<'campaignFacets'>['kind']) => rows.filter(row => row.kind === kind).map(row => ({ id: row.key, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { contentTypes: of('contentType'), categories: of('category'), platforms: of('platform').map(platform => platform.id) };
} });

/**
 * My campaigns: campaigns the signed-in user saved in Revline, or attached one of their projects to.
 * It is Revline's own list and does not mean the user joined the campaign on Content Rewards.
 */
export const mine = query({ args: {}, returns: v.array(v.object({ campaign: campaignView, saved: v.boolean(), projectIds: v.array(v.id('projects')), updatedAt: v.number() })), handler: async ctx => {
  const ownerId = await requireOwner(ctx);
  const entries = new Map<Id<'campaigns'>, { saved: boolean; projectIds: Id<'projects'>[]; updatedAt: number }>();
  const entry = (campaignId: Id<'campaigns'>) => entries.get(campaignId) ?? entries.set(campaignId, { saved: false, projectIds: [], updatedAt: 0 }).get(campaignId)!;
  for (const row of await ctx.db.query('savedCampaigns').withIndex('by_owner', q => q.eq('ownerId', ownerId)).order('desc').take(200)) {
    const item = entry(row.campaignId); item.saved = true; item.updatedAt = Math.max(item.updatedAt, row.savedAt);
  }
  const links = (await ctx.db.query('projectCampaigns').withIndex('by_owner', q => q.eq('ownerId', ownerId)).order('desc').take(300)).filter(row => row.campaignId);
  // A project on its way out no longer counts.
  const live = await Promise.all(links.map(row => projectIdentity(ctx, row.projectId, ownerId).then(() => true, () => false)));
  links.forEach((row, index) => {
    if (!live[index]) return;
    const item = entry(row.campaignId!); item.projectIds.push(row.projectId); item.updatedAt = Math.max(item.updatedAt, row.updatedAt);
  });
  const listed = await Promise.all([...entries].map(async ([campaignId, item]) => { const campaign = await ctx.db.get(campaignId); return campaign ? [{ campaign: viewOf(campaign), ...item }] : []; }));
  return listed.flat().sort((a, b) => b.updatedAt - a.updatedAt);
} });

/** Saves a campaign to My campaigns. A Revline bookmark only. */
export const save = mutation({ args: { campaignId: v.id('campaigns') }, returns: v.null(), handler: async (ctx, { campaignId }) => {
  const ownerId = await requireOwner(ctx);
  if (!await ctx.db.get(campaignId)) throw new ConvexError('Campaign not found');
  const saved = await ctx.db.query('savedCampaigns').withIndex('by_owner_campaign', q => q.eq('ownerId', ownerId).eq('campaignId', campaignId)).unique();
  if (!saved) {
    if ((await ctx.db.query('savedCampaigns').withIndex('by_owner', q => q.eq('ownerId', ownerId)).take(200)).length >= 200) throw new ConvexError('You can save up to 200 campaigns');
    await ctx.db.insert('savedCampaigns', { ownerId, campaignId, savedAt: Date.now() });
  }
  return null;
} });
export const unsave = mutation({ args: { campaignId: v.id('campaigns') }, returns: v.null(), handler: async (ctx, { campaignId }) => {
  const ownerId = await requireOwner(ctx);
  const saved = await ctx.db.query('savedCampaigns').withIndex('by_owner_campaign', q => q.eq('ownerId', ownerId).eq('campaignId', campaignId)).unique();
  if (saved) await ctx.db.delete(saved._id);
  return null;
} });

/** The campaign a project is attached to, if any. `declined`: the user removed one, so none is attached automatically. */
export const forProject = query({ args: { projectId: v.id('projects') }, returns: v.object({ campaign: v.union(campaignView, v.null()), how: v.optional(v.union(v.literal('matched'), v.literal('picked'))), declined: v.boolean() }), handler: async (ctx, { projectId }) => {
  await projectIdentity(ctx, projectId, await requireOwner(ctx));
  const link = await projectLink(ctx, projectId);
  const campaign = link?.campaignId ? await ctx.db.get(link.campaignId) : null;
  return { campaign: campaign ? viewOf(campaign) : null, ...(campaign && link ? { how: link.how } : {}), declined: !!link?.declined };
} });

async function setProjectCampaign(ctx: MutationCtx, ownerId: string, projectId: Id<'projects'>, next: { campaignId: Id<'campaigns'>; how: 'matched' | 'picked' } | null) {
  const link = await projectLink(ctx, projectId);
  const row = { projectId, ownerId, updatedAt: Date.now(), ...(next ? { campaignId: next.campaignId, how: next.how } : { how: link?.how ?? 'picked' as const, declined: true }) };
  if (link) await ctx.db.replace(link._id, row); else await ctx.db.insert('projectCampaigns', row);
}
/** Attaches the user's project to a campaign they picked, replacing any earlier one. */
export const attachProject = mutation({ args: { projectId: v.id('projects'), campaignId: v.id('campaigns') }, returns: v.null(), handler: async (ctx, { projectId, campaignId }) => {
  const ownerId = await requireOwner(ctx);
  await projectIdentity(ctx, projectId, ownerId);
  if (!await ctx.db.get(campaignId)) throw new ConvexError('Campaign not found');
  await setProjectCampaign(ctx, ownerId, projectId, { campaignId, how: 'picked' });
  return null;
} });
/** Removes the project's campaign. Matching will not attach one again on its own; the user can still pick one. */
export const detachProject = mutation({ args: { projectId: v.id('projects') }, returns: v.null(), handler: async (ctx, { projectId }) => {
  const ownerId = await requireOwner(ctx);
  await projectIdentity(ctx, projectId, ownerId);
  await setProjectCampaign(ctx, ownerId, projectId, null);
  return null;
} });

const postCampaign = v.object({ campaignId: v.id('campaigns'), name: v.string(), organization: v.optional(v.string()), url: v.string(), ended: v.boolean(),
  /** Cents per 1,000 views and payout bounds, per platform. */
  payouts: v.array(v.object({ platform: v.string(), rateCents: v.optional(v.number()), minPayoutCents: v.optional(v.number()), maxPayoutCents: v.optional(v.number()) })) });
/** The pay terms of a campaign id as stored on a post (a plain string), or null when it names no campaign. */
export async function campaignRates(ctx: QueryCtx | MutationCtx, campaignId: string) {
  const id = ctx.db.normalizeId('campaigns', campaignId);
  const campaign = id && await ctx.db.get(id);
  if (!campaign) return null;
  return { campaignId: campaign._id, name: campaign.name, ...(campaign.organization ? { organization: campaign.organization.name } : {}), url: campaign.url, ended: campaign.ended, payouts: campaign.payouts };
}
/** For a post that carries a campaign id: what each platform pays, so estimated earnings can be worked out. */
export const campaignForPost = query({ args: { campaignId: v.string() }, returns: v.union(postCampaign, v.null()), handler: async (ctx, { campaignId }) => {
  await requireOwner(ctx);
  return campaignRates(ctx, campaignId);
} });

// ── Used by the search and matching actions (convex/campaignsSearch.ts) ─────────────────────────────────────

const filters = v.object(campaignFilters);
const found = v.array(v.object({ campaign: campaignView, score: v.optional(v.number()) }));
const pageSize = (limit: number | undefined) => Math.max(1, Math.min(limit ?? 24, 50));
const BROWSE_SCAN = 2000;

/** The signed-in owner, with the same account checks as every query (an action has no database to run them on). */
export const owner = internalQuery({ args: {}, returns: v.string(), handler: ctx => requireOwner(ctx) });

/** No search text: campaigns that pass the filters, hottest first. */
export const browse = internalQuery({ args: { filters, limit: v.optional(v.number()) }, returns: found, handler: async (ctx, args) => {
  const results: { campaign: ReturnType<typeof viewOf> }[] = [];
  let scanned = 0;
  for await (const campaign of ctx.db.query('campaigns').withIndex('by_ended_hot', q => q.eq('ended', false)).order('desc')) {
    if (passesFilters(campaign, args.filters)) results.push({ campaign: viewOf(campaign) });
    // A filter few campaigns pass must not read the whole table.
    if (results.length >= pageSize(args.limit) || ++scanned >= BROWSE_SCAN) break;
  }
  return results;
} });
/** Vector search hits, in order of closeness, cut down to the campaigns that pass the filters. */
export const ranked = internalQuery({ args: { hits: v.array(v.object({ id: v.id('campaignEmbeddings'), score: v.number() })), filters, limit: v.optional(v.number()) }, returns: found, handler: async (ctx, args) => {
  const results: { campaign: ReturnType<typeof viewOf>; score: number }[] = [];
  for (const hit of args.hits) {
    const row = await ctx.db.get(hit.id);
    const campaign = row && await ctx.db.get(row.campaignId);
    if (campaign && passesFilters(campaign, args.filters)) results.push({ campaign: viewOf(campaign), score: hit.score });
    if (results.length >= pageSize(args.limit)) break;
  }
  return results;
} });
/** Word search over the same text, for when no embedding can be made. */
export const keyword = internalQuery({ args: { text: v.string(), filters, limit: v.optional(v.number()) }, returns: found, handler: async (ctx, args) => {
  const hits = await ctx.db.query('campaigns').withSearchIndex('search_text', q => q.search('searchText', args.text).eq('ended', false)).take(120);
  return hits.filter(campaign => passesFilters(campaign, args.filters)).slice(0, pageSize(args.limit)).map(campaign => ({ campaign: viewOf(campaign) }));
} });

/** What matching needs: whether this project may be attached automatically, and every running campaign's name. */
export const matchContext = internalQuery({ args: { ownerId: v.string(), projectId: v.id('projects') },
  returns: v.object({ open: v.boolean(), names: v.array(v.object({ id: v.id('campaigns'), sourceId: v.string(), name: v.string(), organization: v.optional(v.string()) })) }),
  handler: async (ctx, { ownerId, projectId }) => {
    await projectIdentity(ctx, projectId, ownerId);
    const link = await projectLink(ctx, projectId);
    if (link?.campaignId || link?.declined) return { open: false, names: [] };
    const names = await ctx.db.query('campaignNames').take(5000);
    return { open: true, names: names.map(row => ({ id: row.campaignId, sourceId: row.sourceId, name: row.name, ...(row.organization ? { organization: row.organization } : {}) })) };
  } });
export const views = internalQuery({ args: { campaignIds: v.array(v.id('campaigns')) }, returns: v.array(campaignView), handler: async (ctx, { campaignIds }) =>
  (await Promise.all(campaignIds.slice(0, 10).map(id => ctx.db.get(id)))).flatMap(campaign => campaign && !campaign.ended ? [viewOf(campaign)] : []) });
export const embeddingsOf = internalQuery({ args: { campaignIds: v.array(v.id('campaigns')) }, returns: v.array(v.object({ campaignId: v.id('campaigns'), embedding: v.array(v.float64()) })), handler: async (ctx, { campaignIds }) =>
  (await Promise.all(campaignIds.slice(0, 10).map(campaignId => ctx.db.query('campaignEmbeddings').withIndex('by_campaign', q => q.eq('campaignId', campaignId)).unique()))).flatMap(row => row ? [{ campaignId: row.campaignId, embedding: row.embedding }] : []) });

/** Attaches a project to the one campaign its text clearly named. Never replaces a campaign or overrides a removal. */
export const attachMatched = internalMutation({ args: { ownerId: v.string(), projectId: v.id('projects'), campaignId: v.id('campaigns') }, returns: v.boolean(), handler: async (ctx, { ownerId, projectId, campaignId }) => {
  await projectIdentity(ctx, projectId, ownerId);
  const link = await projectLink(ctx, projectId);
  const campaign = await ctx.db.get(campaignId);
  if (link?.campaignId || link?.declined || !campaign || campaign.ended) return false;
  await setProjectCampaign(ctx, ownerId, projectId, { campaignId, how: 'matched' });
  return true;
} });

/** The text to embed for a campaign, unless its stored embedding already matches that text. */
export const embeddingText = internalQuery({ args: { campaignId: v.id('campaigns') }, returns: v.union(v.null(), v.object({ text: v.string(), textHash: v.string() })), handler: async (ctx, { campaignId }) => {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign?.searchText) return null;
  const textHash = fingerprint(campaign.searchText);
  const row = await ctx.db.query('campaignEmbeddings').withIndex('by_campaign', q => q.eq('campaignId', campaignId)).unique();
  return row?.textHash === textHash ? null : { text: campaign.searchText, textHash };
} });
export const saveEmbedding = internalMutation({ args: { campaignId: v.id('campaigns'), textHash: v.string(), embedding: v.array(v.float64()) }, returns: v.null(), handler: async (ctx, { campaignId, textHash, embedding }) => {
  const campaign = await ctx.db.get(campaignId);
  // The text may have changed while the embedding was being made; the newer upsert has asked for its own.
  if (!campaign || fingerprint(campaign.searchText) !== textHash || embedding.length !== EMBEDDING_DIMENSIONS) return null;
  const row = await ctx.db.query('campaignEmbeddings').withIndex('by_campaign', q => q.eq('campaignId', campaignId)).unique();
  if (row) await ctx.db.replace(row._id, { campaignId, textHash, embedding }); else await ctx.db.insert('campaignEmbeddings', { campaignId, textHash, embedding });
  return null;
} });
