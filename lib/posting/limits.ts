// Limits shared by the server checks and the forms. Safe to import in the browser.
export const MAX_ATTEMPTS = 3;
export const CAPTION_LIMIT = 2200;
export const TITLE_LIMIT = 100;
/**
 * What every page and tool says while Revline's Post Bridge key is not set on the server: nothing can be connected
 * or sent, queued posts wait, and stored stats still show. Setting the key turns posting on with no other change.
 */
export const POSTING_NOT_SET_UP = 'Posting isn’t set up yet: no Post Bridge key provided.';
