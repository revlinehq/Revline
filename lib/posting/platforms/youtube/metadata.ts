import { PostingError, type PublishInput } from '../../adapter';

// Limits from the video resource. https://developers.google.com/youtube/v3/docs/videos#snippet
export const TITLE_MAX_CHARS = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
/** Shorts: square or vertical, up to three minutes. https://support.google.com/youtube/answer/15424877 */
export const SHORT_MAX_SECONDS = 180;
/** "People & Blogs", the category YouTube Studio picks by default. */
const DEFAULT_CATEGORY_ID = '22';

/**
 * YouTube settings the shared PublishInput cannot carry yet. Until the base adds them, publish reads them
 * from an optional `youtube` field on the input and otherwise uses the defaults below.
 */
export type YouTubePublishOptions = {
  /** Default 'public'. YouTube's policies require the user to be offered this choice. */
  privacyStatus?: 'public' | 'unlisted' | 'private';
  /** Default false. */
  madeForKids?: boolean;
  /** Discloses realistic altered or AI-made content. Left unset unless given. */
  containsSyntheticMedia?: boolean;
  /** Default true (YouTube's own default). */
  notifySubscribers?: boolean;
};

export type VideoMetadata = {
  snippet: { title: string; description: string; categoryId: string };
  status: { privacyStatus: string; selfDeclaredMadeForKids: boolean; containsSyntheticMedia?: boolean };
};

/** YouTube sorts a video into Shorts by shape and length alone; the API has no "Short" flag. */
export function isShort(input: Pick<PublishInput, 'durationSeconds' | 'width' | 'height'>): boolean {
  return input.height >= input.width && input.durationSeconds <= SHORT_MAX_SECONDS;
}

// < and > are the only characters YouTube refuses in titles and descriptions. Captions use them ("<3", "->"),
// so swap in the look-alike full-width forms rather than fail the post.
function withoutAngleBrackets(text: string): string {
  return text.replace(/</g, '＜').replace(/>/g, '＞');
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max;
  return text.slice(0, end);
}

/** A title from the caption: its first line, shortened at a word boundary. */
export function titleFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).map((part) => part.replace(/\s+/g, ' ').trim()).find((part) => part.length > 0) ?? '';
  if (line.length <= TITLE_MAX_CHARS) return line;
  const head = cut(line, TITLE_MAX_CHARS - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > TITLE_MAX_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

export function buildMetadata(input: PublishInput, options: YouTubePublishOptions = {}): VideoMetadata {
  const given = input.title?.replace(/\s+/g, ' ').trim();
  const title = withoutAngleBrackets(given || titleFromCaption(input.caption));
  if (!title) throw new PostingError('YouTube needs a title. Add a title or a caption.', false, 'invalidTitle');
  // A title the user typed is never shortened for them.
  if (title.length > TITLE_MAX_CHARS) {
    throw new PostingError(`The title is ${title.length} characters long. YouTube allows ${TITLE_MAX_CHARS}.`, false, 'invalidTitle');
  }
  const description = withoutAngleBrackets(input.caption);
  const bytes = new TextEncoder().encode(description).length;
  if (bytes > DESCRIPTION_MAX_BYTES) {
    throw new PostingError(`The caption is too long for a YouTube description (${bytes} bytes; YouTube allows ${DESCRIPTION_MAX_BYTES}).`, false, 'invalidDescription');
  }
  return {
    snippet: { title, description, categoryId: DEFAULT_CATEGORY_ID },
    status: {
      privacyStatus: options.privacyStatus ?? 'public',
      selfDeclaredMadeForKids: options.madeForKids ?? false,
      ...(options.containsSyntheticMedia === undefined ? {} : { containsSyntheticMedia: options.containsSyntheticMedia }),
    },
  };
}
