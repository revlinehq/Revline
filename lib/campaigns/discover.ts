// Reading Content Rewards' public Discover page: the featured banner, Trending this week, New campaigns,
// Most searched and Top clips, in the order their page lists them. Pure text in, typed lists out: nothing here
// makes a request. A section this parser does not understand is left out, so the stored one stays.
import { clip, flightText, isSourceId, type ParsedCampaign } from './source';

/** The public Discover page (`/discover` redirects here, and the reader follows no redirects). */
export const DISCOVER_URL = 'https://contentrewards.com/c/discover';
/** A little under the hourly tick, so each tick's first batch reads it once. */
export const DISCOVER_EVERY_MS = 55 * 60_000;

const MAX_SECTION = 30;
const MAX_CLIPS = 16;
/** Hosts a clip may link out to: the platforms campaigns pay on. */
const POST_HOSTS = ['instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'facebook.com', 'fb.watch'];

export type DiscoverItem = { sourceId: string; category?: string };
/** One clip as their page lists it. The clipper's name and earnings are not kept. */
export type DiscoverClip = { sourceId: string; postUrl: string; platform: string; views: number; title?: string; thumbnailUrl?: string };
export type DiscoverSections = { hero?: DiscoverItem[]; trending?: DiscoverItem[]; fresh?: DiscoverItem[]; searched?: DiscoverItem[]; clips?: DiscoverClip[] };
export type DiscoverReading =
  /** `campaigns`: every campaign a section names, once, from the fields the Discover page itself carries. */
  | { kind: 'sections'; sections: DiscoverSections; campaigns: ParsedCampaign[]; problems: string[] }
  | { kind: 'parse'; reason: string };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

/**
 * The stream's rows by id. A text row ("<id>:T<bytes in hex>,<text>") is kept as its text; any other row runs
 * to the end of its line and is kept raw.
 */
function flightRows(flight: string) {
  const bytes = new TextEncoder().encode(flight), decoder = new TextDecoder();
  const texts = new Map<string, string>(), raw: string[] = [];
  for (let at = 0; at < bytes.length;) {
    let colon = at;
    while (colon < bytes.length && bytes[colon] !== 58 && colon - at < 12) colon++;
    if (bytes[colon] !== 58) break;
    const id = decoder.decode(bytes.subarray(at, colon));
    if (bytes[colon + 1] === 84) {
      const comma = bytes.indexOf(44, colon);
      const length = comma < 0 ? NaN : parseInt(decoder.decode(bytes.subarray(colon + 2, comma)), 16);
      if (!Number.isFinite(length)) break;
      texts.set(id, decoder.decode(bytes.subarray(comma + 1, comma + 1 + length)));
      at = comma + 1 + length;
    } else {
      const end = bytes.indexOf(10, colon);
      raw.push(decoder.decode(bytes.subarray(colon + 1, end < 0 ? bytes.length : end)));
      at = end < 0 ? bytes.length : end + 1;
    }
  }
  return { texts, raw };
}

/** Every cached query (`{ queryKey: [...], state }`) anywhere in a parsed value. */
function queriesIn(value: unknown, found: Json[] = [], depth = 0) {
  if (depth > 40 || !value || typeof value !== 'object') return found;
  if (isObject(value) && Array.isArray(value.queryKey) && isObject(value.state)) { found.push(value); return found; }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) queriesIn(entry, found, depth + 1);
  return found;
}

/**
 * Reads a saved or fetched Discover page. Never throws. Each section is read on its own: one that is missing
 * or oddly shaped is reported in `problems` and left out of `sections`.
 */
export function parseDiscoverPage(html: string): DiscoverReading {
  try {
    const flight = flightText(html);
    if (!flight) return { kind: 'parse', reason: 'page carries no embedded data' };
    const { texts, raw } = flightRows(flight);
    /** React's flight encoding: "$undefined", a literal leading "$" as "$$", long text as a pointer ("$7b"). */
    const plain = (value: unknown) => {
      if (typeof value !== 'string' || !value.startsWith('$')) return value ?? undefined;
      if (value.startsWith('$$')) return value.slice(1);
      return /^\$[0-9a-f]+$/.test(value) ? texts.get(value.slice(1)) : undefined;
    };
    const text = (source: Json, key: string, max = 300) => { const value = plain(source[key]); return typeof value === 'string' && value.trim() ? clip(value.trim(), max) : undefined; };
    const amount = (source: Json, key: string) => { const value = plain(source[key]); return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; };
    const link = (source: Json, key: string) => { const value = text(source, key, 600); return value && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : undefined; };
    const cents = (dollars: number | undefined) => dollars === undefined ? undefined : Math.round(dollars * 100);

    const campaigns = new Map<string, ParsedCampaign>();
    /** A campaign card on their page, as the record our campaign pages use. Undefined when it names no campaign. */
    const campaignOf = (value: unknown): DiscoverItem | undefined => {
      if (!isObject(value)) return undefined;
      const sourceId = text(value, 'id', 80), name = text(value, 'title');
      if (!sourceId || !isSourceId(sourceId) || !name) return undefined;
      const brand = text(value, 'brand');
      const payoutType = text(value, 'type', 40)?.toLowerCase();
      const rate = payoutType === 'cpm' ? cents(amount(value, 'payoutSortRaw')) : undefined;
      const platforms = Array.isArray(value.platforms) ? [...new Set(value.platforms.filter((entry): entry is string => typeof entry === 'string' && !!entry && entry.length <= 40).map(entry => entry.toLowerCase()))].slice(0, 12) : [];
      const percent = amount(value, 'progressPercentage');
      const launchedAt = amount(value, 'launchedAtMs');
      const requiresApplication = plain(value.requiresApplication), verified = plain(value.isVerified);
      if (!campaigns.has(sourceId)) campaigns.set(sourceId, compact({
        sourceId, name,
        // Their Discover page lists only campaigns that are running.
        status: 'active',
        organization: brand ? compact({ name: brand, handle: text(value, 'organizationProfileHandle', 120), verified: typeof verified === 'boolean' ? verified : undefined, logoUrl: link(value, 'avatar') }) : undefined,
        description: text(value, 'description', 6000),
        imageUrl: link(value, 'thumbnail'),
        payoutType,
        // A zero total is "none stated", not "used up".
        budgetCents: cents(amount(value, 'budgetTotalRaw')) || undefined,
        budgetSpentCents: cents(amount(value, 'budgetSpentRaw')),
        budgetProgressBps: percent === undefined ? undefined : Math.round(percent * 100),
        creatorCount: amount(value, 'creatorCountRaw') === undefined ? undefined : Math.round(amount(value, 'creatorCountRaw')!),
        payouts: platforms.map(platform => rate ? { platform, rateCents: rate } : { platform }),
        contentTypes: [], contentCategories: [],
        requiresApplication: typeof requiresApplication === 'boolean' ? requiresApplication : undefined,
        launchedAt: launchedAt === undefined ? undefined : Math.round(launchedAt),
      }));
      return compact({ sourceId, category: text(value, 'category', 80) });
    };
    const items = (list: unknown, pick: (entry: unknown) => unknown): DiscoverItem[] | undefined => {
      if (!Array.isArray(list)) return undefined;
      const seen = new Set<string>();
      return list.slice(0, MAX_SECTION).flatMap(entry => {
        const item = campaignOf(pick(entry));
        if (!item || seen.has(item.sourceId)) return [];
        seen.add(item.sourceId);
        return [item];
      });
    };
    const wrapped = (entry: unknown) => isObject(entry) ? entry.campaign : undefined;
    const feed = (data: unknown) => isObject(data) && Array.isArray(data.pages) && isObject(data.pages[0]) ? items(data.pages[0].campaigns, entry => entry) : undefined;
    /** Top clips: each listed campaign's best clip first, then each one's second, as far as the cap. */
    const clipsOf = (data: unknown): DiscoverClip[] | undefined => {
      if (!Array.isArray(data)) return undefined;
      const perCampaign = data.slice(0, MAX_SECTION).flatMap((entry): DiscoverClip[][] => {
        const item = campaignOf(wrapped(entry));
        const metrics = isObject(entry) && isObject(entry.metrics) ? entry.metrics : undefined;
        if (!item || !metrics || !Array.isArray(metrics.topClips)) return [];
        return [metrics.topClips.flatMap((value): DiscoverClip[] => {
          if (!isObject(value)) return [];
          const postUrl = link(value, 'postUrl'), views = amount(value, 'totalViews'), platform = text(value, 'platform', 40)?.toLowerCase();
          if (!postUrl || views === undefined || !platform) return [];
          const host = new URL(postUrl).hostname.replace(/^(www|m|vm)\./, '');
          if (!POST_HOSTS.includes(host)) return [];
          return [compact({ sourceId: item.sourceId, postUrl, platform, views: Math.round(views), title: text(value, 'title', 200), thumbnailUrl: link(value, 'thumbnailUrl') })];
        })];
      });
      const clips: DiscoverClip[] = [];
      for (let rank = 0; clips.length < MAX_CLIPS && perCampaign.some(list => list.length > rank); rank++) {
        for (const list of perCampaign) if (list[rank] && clips.length < MAX_CLIPS) clips.push(list[rank]);
      }
      return clips;
    };

    const queries = raw.filter(row => row.includes('"queryKey"') && (row[0] === '[' || row[0] === '{')).flatMap(row => {
      try { return queriesIn(JSON.parse(row)); } catch { return []; }
    });
    const data = (matches: (key: unknown[]) => boolean) => {
      const query = queries.find(entry => matches(entry.queryKey as unknown[]));
      return query ? plain((query.state as Json).data) : undefined;
    };
    const feedRow = (row: string) => (key: unknown[]) => key[0] === 'discover' && key[1] === 'feed' && isObject(key[2]) && key[2].row === row;
    const searched = data(key => key[0] === 'campaigns' && key[1] === 'discover-top-searched');
    const read: [keyof DiscoverSections, DiscoverItem[] | DiscoverClip[] | undefined][] = [
      ['hero', items(data(key => key[0] === 'campaigns' && key[1] === 'discover-hero'), wrapped)],
      ['trending', feed(data(feedRow('trending')))],
      ['fresh', feed(data(feedRow('new')))],
      ['searched', isObject(searched) ? items(searched.items, wrapped) : undefined],
      ['clips', clipsOf(data(key => key[0] === 'campaigns' && key[1] === 'discover-top-clips'))],
    ];
    const sections = Object.fromEntries(read.filter(([, list]) => list)) as DiscoverSections;
    const problems = read.filter(([, list]) => !list).map(([name]) => `${name}: not in the page data`);
    if (problems.length === read.length) return { kind: 'parse', reason: 'no Discover section in the page data' };
    // Only campaigns a kept section names are stored.
    const named = new Set(Object.values(sections).flatMap(list => list.map(entry => entry.sourceId)));
    return { kind: 'sections', sections, campaigns: [...campaigns.values()].filter(campaign => named.has(campaign.sourceId)), problems };
  } catch (error) {
    return { kind: 'parse', reason: `unreadable page data: ${error instanceof Error ? error.message : 'unknown error'}`.slice(0, 300) };
  }
}
