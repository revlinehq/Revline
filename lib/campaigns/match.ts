// Matching what a user dropped into a project (instructions, a link, any text) against stored campaigns by
// organization and name. Pure scoring; convex/campaignsSearch.ts adds the embedding tiebreak and the attach.

export type CampaignName = { id: string; name: string; organization?: string };
export type CampaignCandidate = { id: string; score: number; exactName: boolean;
  /** Enough to attach without asking: the organization is named too, or the full name of three or more words appears as written. */
  strong: boolean };
export type MatchVerdict =
  | { kind: 'match'; id: string }
  /** Several campaigns fit equally well: `tied` are the ones an embedding comparison should separate. */
  | { kind: 'unclear'; choices: string[]; tied: string[] }
  | { kind: 'none' };

/** A project is attached on its own at this score, when the evidence is strong and nothing else comes close. */
export const ATTACH_SCORE = 0.7;
/** How far ahead the best candidate must be to count as the only match. */
export const CLEAR_MARGIN = 0.15;
/** Below this a campaign is not worth offering. */
const OFFER_SCORE = 0.32;
const MAX_TEXT = 20_000;
/** Words any editing request or brief may contain. They count for little, however rare they are among campaign names. */
const EVERYDAY = new Set(('a an and are at by for from in is of on or per the this to with your you our new official best top free '
  + 'clip clips clipping clipper clippers campaign campaigns content creator creators video videos short shorts reel reels edit edits editing '
  + 'podcast podcasts music song sound audio logo ugc face faceless slideshow slideshows caption captions subtitle subtitles stream streams streamer '
  + 'tiktok instagram youtube twitter facebook x post posts view views earn pay paid payout budget pool rewards reward cpm 1k day days').split(' '));

/** Lowercase words and numbers, accents removed. */
export function words(text: string) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function editDistanceWithin(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > limit) return false;
    previous = row;
  }
  return previous[b.length] <= limit;
}

/**
 * Scores every campaign against the text, best first.
 * Name: 1 when the whole name appears as written, otherwise 0.9 × the share of its words found (rare words
 * weigh more, a long word may be one or two letters off), scaled down for names made only of common words.
 * Organization: 1 when it appears as written. Score = 0.8 × name + 0.2 × organization.
 * Everyday words ("clips", "podcast", "captions") weigh little. A word that is rare among campaign names can
 * still be ordinary, so a name alone
 * is `strong` only as a full phrase of three or more words; otherwise the organization must be named as well.
 */
export function rankCampaigns(text: string, campaigns: CampaignName[]): CampaignCandidate[] {
  const textWords = words(text.slice(0, MAX_TEXT));
  if (!textWords.length || !campaigns.length) return [];
  const spaced = ` ${textWords.join(' ')} `;
  const present = new Set(textWords);
  const byLength = new Map<number, string[]>();
  for (const word of present) { const bucket = byLength.get(word.length); if (bucket) bucket.push(word); else byLength.set(word.length, [word]); }
  const named = campaigns.map(campaign => ({ campaign, name: words(campaign.name), organization: words(campaign.organization ?? '') }));
  const frequency = new Map<string, number>();
  for (const entry of named) for (const word of new Set(entry.name)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const weight = (word: string) => Math.log(1 + campaigns.length / (frequency.get(word) ?? 1)) * (EVERYDAY.has(word) ? 0.15 : 1);
  const rarest = Math.log(1 + campaigns.length);
  const near = new Map<string, boolean>();
  const found = (word: string) => {
    if (present.has(word)) return true;
    if (word.length < 5) return false;
    const cached = near.get(word);
    if (cached !== undefined) return cached;
    const limit = word.length >= 9 ? 2 : 1;
    let hit = false;
    for (let length = word.length - limit; length <= word.length + limit && !hit; length++)
      hit = (byLength.get(length) ?? []).some(other => other[0] === word[0] && editDistanceWithin(word, other, limit));
    near.set(word, hit);
    return hit;
  };
  const candidates: CampaignCandidate[] = [];
  for (const { campaign, name, organization } of named) {
    if (!name.length) continue;
    const distinct = [...new Set(name)];
    const exactName = (name.length > 1 || name[0]!.length >= 5) && spaced.includes(` ${name.join(' ')} `);
    const total = distinct.reduce((sum, word) => sum + weight(word), 0);
    const covered = distinct.reduce((sum, word) => sum + (found(word) ? weight(word) : 0), 0);
    // A name such as "Clipping Campaign" is in every brief; it must not match on its own.
    const distinctive = Math.min(1, Math.max(...distinct.map(weight)) / rarest / 0.5);
    const nameScore = (exactName ? 1 : 0.9 * covered / total) * distinctive;
    const organizationScore = organization.length && (organization.length > 1 || organization[0]!.length >= 4) && spaced.includes(` ${organization.join(' ')} `) ? 1 : 0;
    const score = 0.8 * nameScore + 0.2 * organizationScore;
    const strong = organizationScore === 1 ? nameScore >= 0.6 : exactName && name.length >= 3;
    if (nameScore >= 0.4 && score >= OFFER_SCORE) candidates.push({ id: campaign.id, score: Math.round(score * 1000) / 1000, exactName, strong });
  }
  return candidates.sort((a, b) => b.score - a.score || Number(b.exactName) - Number(a.exactName));
}

/** One clear match, an unclear few to pick from, or nothing worth showing. */
export function decideMatch(ranked: CampaignCandidate[]): MatchVerdict {
  const [best, second] = ranked;
  if (!best) return { kind: 'none' };
  const choices = ranked.slice(0, 3).map(candidate => candidate.id);
  if (best.score < ATTACH_SCORE || !best.strong) return { kind: 'unclear', choices, tied: [] };
  if (!second || best.score - second.score >= CLEAR_MARGIN) return { kind: 'match', id: best.id };
  return { kind: 'unclear', choices, tied: ranked.filter(candidate => candidate.strong && best.score - candidate.score < CLEAR_MARGIN).slice(0, 6).map(candidate => candidate.id) };
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, lengthA = 0, lengthB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index++) { dot += a[index] * b[index]; lengthA += a[index] ** 2; lengthB += b[index] ** 2; }
  return lengthA && lengthB ? dot / Math.sqrt(lengthA * lengthB) : 0;
}
/** How much closer in meaning the best tied campaign must be to win the tie. */
export const TIEBREAK_MARGIN = 0.03;
