"use node";
// Search over stored campaigns by meaning, and matching a project's text to a campaign. Both use OpenAI
// embeddings (OPENAI_API_KEY) with Convex vector search; without a key, search falls back to word search and
// matching to names alone.
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { EMBEDDING_DIMENSIONS, campaignFilters, campaignView, type CampaignView } from './campaignsModel';
import { activeOpenAIKey } from '../lib/ai/openai-keys';
import { TIEBREAK_MARGIN, cosine, decideMatch, rankCampaigns } from '../lib/campaigns/match';
import { campaignIdsInText } from '../lib/campaigns/source';

const EMBEDDING_MODEL = 'text-embedding-3-small';

/** One embedding, or null when no key is set or OpenAI does not answer. The caller decides what to do without it. */
async function embedText(text: string): Promise<number[] | null> {
  const apiKey = activeOpenAIKey();
  if (!apiKey) return null;
  try {
    const base = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const response = await fetch(`${base}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { console.warn(`[campaigns] Embedding request failed: HTTP ${response.status}`); return null; }
    const body = await response.json() as { data?: { embedding?: unknown }[] };
    const vector = body.data?.[0]?.embedding;
    return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS && vector.every(value => typeof value === 'number') ? vector as number[] : null;
  } catch (error) { console.warn(`[campaigns] Embedding request failed: ${error instanceof Error ? error.name : 'error'}`); return null; }
}

/** The signed-in owner, checked the way queries check it (signed in, account not being deleted). */
const signedIn = (ctx: ActionCtx): Promise<string> => ctx.runQuery(internal.campaigns.owner, {});

/** Embeds a campaign's searchable text. Scheduled by an upsert, and only when that text changed. */
export const embed = internalAction({ args: { campaignId: v.id('campaigns') }, returns: v.null(), handler: async (ctx, { campaignId }): Promise<null> => {
  const pending = await ctx.runQuery(internal.campaigns.embeddingText, { campaignId });
  if (!pending) return null;
  const embedding = await embedText(pending.text);
  if (embedding) await ctx.runMutation(internal.campaigns.saveEmbedding, { campaignId, textHash: pending.textHash, embedding });
  else console.warn(`[campaigns] No embedding stored for ${campaignId}${activeOpenAIKey() ? '' : ' (OPENAI_API_KEY is not set)'}; it is asked for again the next time the campaign is read.`);
  return null;
} });

type Found = { campaign: CampaignView; score?: number }[];
/**
 * Campaign search. With text: ranked by meaning ("meaning"), or by words when no embedding can be made
 * ("words"). Without text: filtered and sorted by hot score ("hot"). Ended campaigns are never returned.
 */
export const search = action({ args: { text: v.optional(v.string()), ...campaignFilters, limit: v.optional(v.number()) },
  returns: v.object({ order: v.union(v.literal('meaning'), v.literal('words'), v.literal('hot')), campaigns: v.array(v.object({ campaign: campaignView, score: v.optional(v.number()) })) }),
  handler: async (ctx, { text, limit, ...filters }): Promise<{ order: 'meaning' | 'words' | 'hot'; campaigns: Found }> => {
    await signedIn(ctx);
    const wanted = text?.trim().slice(0, 2000) ?? '';
    if (!wanted) return { order: 'hot', campaigns: await ctx.runQuery(internal.campaigns.browse, { filters, limit }) };
    const vector = await embedText(wanted);
    if (!vector) return { order: 'words', campaigns: await ctx.runQuery(internal.campaigns.keyword, { text: wanted, filters, limit }) };
    // Filters are applied after the vector search (rates and lists are not vector-index filters), so ask for many.
    const hits = await ctx.vectorSearch('campaignEmbeddings', 'by_embedding', { vector, limit: 256 });
    return { order: 'meaning', campaigns: await ctx.runQuery(internal.campaigns.ranked, { hits: hits.map(hit => ({ id: hit._id, score: hit._score })), filters, limit }) };
  } });

type Match = { status: 'attached'; campaign: CampaignView } | { status: 'choices'; choices: CampaignView[] } | { status: 'none' };
/**
 * Matches text the user dropped into a project (instructions, a link, anything) against stored campaigns by
 * organization and name, with embeddings to separate near ties. One clear match is attached and returned so
 * the editor can show it; an unclear one returns up to three to pick from. A project that already has a
 * campaign, or whose campaign the user removed, is left alone.
 */
export const matchProject = action({ args: { projectId: v.id('projects'), text: v.string() },
  returns: v.union(v.object({ status: v.literal('attached'), campaign: campaignView }), v.object({ status: v.literal('choices'), choices: v.array(campaignView) }), v.object({ status: v.literal('none') })),
  handler: async (ctx, { projectId, text }): Promise<Match> => {
    const ownerId = await signedIn(ctx);
    if (text.trim().length < 3) return { status: 'none' };
    const context = await ctx.runQuery(internal.campaigns.matchContext, { ownerId, projectId });
    if (!context.open || !context.names.length) return { status: 'none' };
    const attach = async (campaignId: Id<'campaigns'>): Promise<Match> => {
      const attached = await ctx.runMutation(internal.campaigns.attachMatched, { ownerId, projectId, campaignId });
      const [campaign] = attached ? await ctx.runQuery(internal.campaigns.views, { campaignIds: [campaignId] }) : [];
      return campaign ? { status: 'attached', campaign } : { status: 'none' };
    };
    // A pasted campaign link names the campaign outright.
    const linked = campaignIdsInText(text).flatMap(sourceId => context.names.filter(name => name.sourceId === sourceId));
    if (linked.length === 1) return attach(linked[0].id);
    const verdict = decideMatch(rankCampaigns(text, context.names));
    if (verdict.kind === 'none') return { status: 'none' };
    if (verdict.kind === 'match') return attach(verdict.id as Id<'campaigns'>);
    if (verdict.tied.length > 1) {
      const vector = await embedText(text);
      const stored = vector ? await ctx.runQuery(internal.campaigns.embeddingsOf, { campaignIds: verdict.tied as Id<'campaigns'>[] }) : [];
      if (vector && stored.length === verdict.tied.length) {
        const [best, second] = stored.map(row => ({ id: row.campaignId, closeness: cosine(vector, row.embedding) })).sort((a, b) => b.closeness - a.closeness);
        if (best.closeness - second.closeness >= TIEBREAK_MARGIN) return attach(best.id);
      }
    }
    const choices = await ctx.runQuery(internal.campaigns.views, { campaignIds: verdict.choices as Id<'campaigns'>[] });
    return choices.length ? { status: 'choices', choices } : { status: 'none' };
  } });
