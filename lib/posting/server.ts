
// Server-only: reads the deployment's environment. Imported by convex/posting*, never by the browser.

/** Revline's Post Bridge API key. Server only: never returned by a function or logged. */
export const postBridgeKey = () => process.env.POSTBRIDGE_API_KEY || null;
/** Whether accounts can be connected and posted to right now: every platform goes through Post Bridge, so it is one answer for all. Without the key the app says POSTING_NOT_SET_UP (lib/posting/limits.ts). */
export const postingReady = () => !!postBridgeKey();
/** Where Post Bridge sends the user back after the platform's consent screen: Connected accounts, which then reads the new account. */
export const accountsUrl = () => `${process.env.APP_ORIGIN}/accounts`;
