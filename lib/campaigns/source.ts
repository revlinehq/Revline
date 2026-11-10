// Reading Content Rewards' public campaign pages. Pure text in, typed record out: nothing here makes a request.
// The only two URL shapes the reader may ever fetch are named here; everything else (their /api/, anything that
// needs a session) is refused by `readableUrl`.

export const CAMPAIGN_SOURCE = 'contentrewards' as const;
const ORIGIN = 'https://contentrewards.com';
export const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CAMPAIGN_URL = new RegExp(`^${ORIGIN}/c/campaigns/(${UUID})$`);
const SOURCE_ID = new RegExp(`^${UUID}$`);

export const isSourceId = (value: string) => SOURCE_ID.test(value);
export const campaignUrl = (sourceId: string) => `${ORIGIN}/c/campaigns/${sourceId}`;
/** True only for the sitemap and a public campaign page. */
export const readableUrl = (url: string) => url === SITEMAP_URL || CAMPAIGN_URL.test(url);

/** Campaign ids listed in the sitemap, in order, without repeats. Other URLs in it are ignored. */
export function campaignIdsFromSitemap(xml: string): string[] {
  const ids = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const id = CAMPAIGN_URL.exec(match[1])?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Campaign ids named in free text (a pasted campaign link), for attaching a project. */
export function campaignIdsInText(text: string): string[] {
  return [...new Set([...text.matchAll(new RegExp(`contentrewards\\.com/c/campaigns/(${UUID})`, 'gi'))].map(match => match[1].toLowerCase()))];
}

export type CampaignPayout = { platform: string; rateCents?: number; minPayoutCents?: number; maxPayoutCents?: number };
export type CampaignTag = { id: string; name: string };
/** What one public campaign page states. Money is in cents; `rateCents` is per 1,000 views. */
export type ParsedCampaign = {
  sourceId: string; name: string; status: string;
  organization?: { name: string; handle?: string; verified?: boolean; logoUrl?: string };
  description?: string; imageUrl?: string; payoutType?: string;
  budgetCents?: number; budgetSpentCents?: number; budgetProgressBps?: number;
  creatorCount?: number; totalViews?: number; approvedSubmissionCount?: number;
  payouts: CampaignPayout[]; contentTypes: CampaignTag[]; contentCategories: CampaignTag[];
  preApproval?: boolean; requiresApplication?: boolean;
  /** How many rules, creator requirements and references the brief holds. The brief itself is not public. */
  briefCounts?: { contentRules?: number; creatorRequirements?: number; references?: number };
  sourceCreatedAt?: number; launchedAt?: number; sourceUpdatedAt?: number;
};
export type PageReading =
  | { kind: 'campaign'; campaign: ParsedCampaign }
  /** The page loaded and says there is no such public campaign. */
  | { kind: 'no_data'; reason: string }
  /** The page is not shaped the way this parser knows; nothing may be stored from it. */
  | { kind: 'parse'; reason: string };

const MAX_DESCRIPTION = 6000;
const MAX_LIST = 40;

/** Cuts text to a length without leaving half of a surrogate pair (an emoji) at the end. */
export function clip(value: string, max: number) {
  const cut = value.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

class ShapeError extends Error {}
const fail = (reason: string): never => { throw new ShapeError(reason); };
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
/** React's flight encoding writes `undefined` as "$undefined" and a literal leading "$" as "$$". */
const plain = (value: unknown) => value === '$undefined' ? undefined : typeof value === 'string' && value.startsWith('$$') ? value.slice(1) : value;

function field(source: Json, key: string, path: string) { const value = plain(source[key]); return value === null ? undefined : value; }
function text(source: Json, key: string, path: string, max = 300) {
  const value = field(source, key, path);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`${path}.${key}: expected text, found ${typeof value}`);
  const trimmed = (value as string).trim();
  return trimmed ? clip(trimmed, max) : undefined;
}
function count(source: Json, key: string, path: string) {
  const value = field(source, key, path);
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${path}.${key}: expected a non-negative number, found ${JSON.stringify(value)?.slice(0, 40)}`);
  return Math.round(value as number);
}
function flag(source: Json, key: string, path: string) {
  const value = field(source, key, path);
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(`${path}.${key}: expected true or false, found ${typeof value}`);
  return value as boolean;
}
function section(source: Json, key: string, path: string): Json | undefined {
  const value = field(source, key, path);
  if (value === undefined) return undefined;
  if (!isObject(value)) fail(`${path}.${key}: expected an object`);
  return value as Json;
}
function list(source: Json, key: string, path: string): unknown[] {
  const value = field(source, key, path);
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${path}.${key}: expected a list`);
  if ((value as unknown[]).length > MAX_LIST) fail(`${path}.${key}: ${(value as unknown[]).length} entries, more than ${MAX_LIST}`);
  return value as unknown[];
}
function time(source: Json, key: string, path: string) {
  const value = text(source, key, path, 80);
  if (value === undefined) return undefined;
  const at = Date.parse(value.startsWith('$D') ? value.slice(2) : value);
  if (!Number.isFinite(at)) fail(`${path}.${key}: not a date`);
  return at;
}
function link(source: Json, key: string, path: string) {
  const value = text(source, key, path, 600);
  return value && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : undefined;
}
function tags(source: Json | undefined, key: string, path: string): CampaignTag[] {
  if (!source) return [];
  const seen = new Set<string>();
  return list(source, key, path).flatMap((entry, index) => {
    if (!isObject(entry)) return fail(`${path}.${key}[${index}]: expected an object`);
    const id = text(entry, 'id', `${path}.${key}[${index}]`, 80) ?? fail(`${path}.${key}[${index}].id: missing`);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: text(entry, 'name', `${path}.${key}[${index}]`, 80) ?? id }];
  });
}
/** Drops keys whose value is undefined, so a record never carries half-set fields. */
function compact<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T; }

/** Turns the campaign object embedded in a page into a typed record. Throws ShapeError on an unknown shape. */
function campaignFrom(data: Json, sourceId: string, resolve: (value: string) => string | undefined): ParsedCampaign {
  const id = text(data, 'id', 'campaign', 80);
  if (id !== sourceId) fail(`campaign.id: page describes ${id ?? 'no id'}, not ${sourceId}`);
  if (flag(data, 'private', 'campaign')) fail('campaign.private: marked private');
  const metrics = section(data, 'metrics', 'campaign');
  const configuration = section(data, 'configuration', 'campaign');
  const content = configuration && section(configuration, 'content', 'configuration');
  const requirement = configuration && section(configuration, 'requirement', 'configuration');
  const organization = section(data, 'organization', 'campaign');
  const briefCounts = section(data, 'briefCounts', 'campaign');
  const seenPlatforms = new Set<string>();
  const payouts = (configuration ? list(configuration, 'payoutModel', 'configuration') : []).flatMap((entry, index): CampaignPayout[] => {
    const at = `configuration.payoutModel[${index}]`;
    if (!isObject(entry)) return fail(`${at}: expected an object`);
    const platform = (text(entry, 'platform', at, 40) ?? fail(`${at}.platform: missing`)).toLowerCase();
    if (seenPlatforms.has(platform)) return [];
    seenPlatforms.add(platform);
    return [compact({ platform, rateCents: count(entry, 'rate', at), minPayoutCents: count(entry, 'minPayout', at), maxPayoutCents: count(entry, 'maxPayout', at) })];
  });
  const rawDescription = field(data, 'description', 'campaign');
  // Long text is sometimes written once in the page and pointed to ("$1a").
  const description = typeof rawDescription === 'string' && /^\$[0-9a-f]+$/.test(rawDescription)
    ? clip(resolve(rawDescription.slice(1))?.trim() ?? '', MAX_DESCRIPTION) || undefined
    : text(data, 'description', 'campaign', MAX_DESCRIPTION);
  const organizationName = organization && text(organization, 'name', 'organization');
  return compact({
    sourceId,
    name: text(data, 'name', 'campaign') ?? fail('campaign.name: missing'),
    status: (text(data, 'status', 'campaign', 40) ?? fail('campaign.status: missing')).toLowerCase(),
    organization: organization && organizationName ? compact({ name: organizationName, handle: text(organization, 'profileHandle', 'organization', 120), verified: flag(organization, 'verified', 'organization'), logoUrl: link(organization, 'logoUrl', 'organization') }) : undefined,
    description,
    imageUrl: link(data, 'banner', 'campaign'),
    payoutType: text(data, 'type', 'campaign', 40)?.toLowerCase(),
    budgetCents: configuration && count(configuration, 'budget', 'configuration'),
    budgetSpentCents: metrics && count(metrics, 'budgetSpentCents', 'metrics'),
    budgetProgressBps: metrics && count(metrics, 'budgetProgressBps', 'metrics'),
    creatorCount: metrics && count(metrics, 'creatorCount', 'metrics'),
    totalViews: metrics && count(metrics, 'totalViews', 'metrics'),
    approvedSubmissionCount: metrics && count(metrics, 'approvedSubmissionCount', 'metrics'),
    payouts,
    contentTypes: tags(content, 'contentTypes', 'configuration.content'),
    contentCategories: tags(content, 'contentCategories', 'configuration.content'),
    preApproval: requirement && flag(requirement, 'preApproval', 'configuration.requirement'),
    requiresApplication: flag(data, 'requiresApplication', 'campaign'),
    briefCounts: briefCounts && compact({ contentRules: count(briefCounts, 'contentRules', 'briefCounts'), creatorRequirements: count(briefCounts, 'creatorRequirements', 'briefCounts'), references: count(briefCounts, 'references', 'briefCounts') }),
    sourceCreatedAt: time(data, 'createdAt', 'campaign'),
    launchedAt: time(data, 'launchDate', 'campaign'),
    sourceUpdatedAt: time(data, 'updatedAt', 'campaign'),
  });
}

/** The page's streamed data: every `self.__next_f.push([1,"…"])` payload, unescaped and joined. */
function flightText(html: string) {
  let joined = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { joined += JSON.parse(match[1]) as string; } catch { /* a payload that is not a string literal holds nothing we read */ }
  }
  return joined;
}

/** The JSON value starting at `start` (an opening bracket), found by counting brackets outside strings. */
function jsonAt(source: string, start: number): unknown {
  let depth = 0, inString = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) { if (char === '\\') index++; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') { if (--depth === 0) return JSON.parse(source.slice(start, index + 1)); }
  }
  throw new ShapeError('page data ends before its JSON closes');
}

/** Finds the page's cached campaign query (`queryKey: ["campaigns","detail",id]`) anywhere in a parsed value. */
function campaignQuery(value: unknown, sourceId: string, depth = 0): Json | undefined {
  if (depth > 40 || !value || typeof value !== 'object') return undefined;
  if (isObject(value)) {
    const key = value.queryKey;
    if (Array.isArray(key) && key[0] === 'campaigns' && key[1] === 'detail' && key[2] === sourceId) return value;
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    const found = campaignQuery(entry, sourceId, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Reads one saved or fetched campaign page. Never throws: an unknown shape comes back as `parse` with the
 * reason, and a record is returned only when every field it carries was understood.
 */
export function parseCampaignPage(html: string, sourceId: string): PageReading {
  try {
    if (!isSourceId(sourceId)) return { kind: 'parse', reason: 'not a campaign id' };
    const flight = flightText(html);
    if (!flight) return { kind: 'parse', reason: 'page carries no embedded data' };
    const marker = '"queryKey":["campaigns","detail"';
    let query: Json | undefined;
    for (let at = flight.indexOf(marker); at >= 0 && !query; at = flight.indexOf(marker, at + 1)) {
      // The marker sits inside one row of the stream ("<hex id>:<json>"); parse that row and look inside it.
      const rowStart = Math.max(flight.lastIndexOf('\n', at) + 1, 0);
      const prefix = /^[0-9a-f]+:/.exec(flight.slice(rowStart, rowStart + 12));
      if (!prefix) continue;
      const open = rowStart + prefix[0].length;
      if (flight[open] !== '[' && flight[open] !== '{') continue;
      query = campaignQuery(jsonAt(flight, open), sourceId);
    }
    if (!query) return { kind: 'parse', reason: 'no campaign query in the page data' };
    const state = isObject(query.state) ? query.state : fail('campaign query has no state');
    const data = plain(state.data);
    if (data === null || data === undefined) return { kind: 'no_data', reason: `campaign query is empty (${typeof state.status === 'string' ? state.status.slice(0, 40) : 'no status'})` };
    if (!isObject(data)) return { kind: 'parse', reason: 'campaign data is not an object' };
    const resolve = (id: string) => {
      // A text row: "<id>:T<byte length in hex>,<text>".
      const head = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]+),`).exec(flight);
      if (!head) return undefined;
      const start = head.index + head[0].length, bytes = parseInt(head[1], 16);
      return new TextDecoder().decode(new TextEncoder().encode(flight.slice(start, start + bytes)).slice(0, bytes));
    };
    return { kind: 'campaign', campaign: campaignFrom(data, sourceId, resolve) };
  } catch (error) {
    return { kind: 'parse', reason: (error instanceof ShapeError ? error.message : `unreadable page data: ${error instanceof Error ? error.message : 'unknown error'}`).slice(0, 300) };
  }
}
