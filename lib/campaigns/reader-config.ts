// The reader's switch and manners, shared by its Convex mutations and actions.

/** Server environment switch. Unset (or anything but 1/true/on) means the reader does nothing. */
export const READER_SWITCH = 'CAMPAIGN_READER_ENABLED';
export function readerEnabled() {
  const value = process.env[READER_SWITCH]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}
export const READER_OFF = `[campaigns] Reader is off (${READER_SWITCH} is not set): nothing fetched, nothing queued.`;

/** Says who is asking and where to reach us. No browser disguise. */
export const READER_USER_AGENT = 'RevlineCampaignReader/1.0 (+https://tryrevline.com; reads public campaign pages listed in the sitemap, at most one request per second)';
/** At most one request per second, with a little slack. */
export const MIN_REQUEST_INTERVAL_MS = 1100;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_PAGE_BYTES = 4_000_000;
/** Pages per action, so no single action runs long (about 10 to 20 seconds). */
export const READ_BATCH = 8;
/** How long one drain's claim on the queue holds without being renewed. */
export const DRAIN_LEASE_MS = 3 * 60_000;
/** Tries per page before it waits for the next cycle. */
export const MAX_PAGE_ATTEMPTS = 3;
/** Failures in a row (HTTP errors, 429s, network errors, a bad sitemap) that stop the run. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/**
 * Pages that could not be understood or stored, counted up by one for each and down by one for each campaign
 * read and stored. Reaching this stops the run: it takes most pages failing (a block page, a changed page
 * format), which gets there within about ten requests. A minority of odd pages among good ones never does.
 */
export const MAX_UNREADABLE_PAGES = 10;
export const HALT_MS = 6 * 3_600_000;
export const MIN_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 30 * 60_000;
export const SITEMAP_EVERY_MS = 24 * 3_600_000;
export const SITEMAP_RETRY_MS = 3 * 3_600_000;
/** Campaigns at or above this hot score are read hourly, the hottest first, up to the limit. */
export const HOURLY_HOT_SCORE = 40;
export const HOURLY_HOT_LIMIT = 100;
/** Campaigns in someone's My campaigns read hourly, at most. */
export const HOURLY_WATCHED_LIMIT = 300;
export const FAILURE_KEEP_MS = 30 * 86_400_000;
