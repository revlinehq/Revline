import { reportClientFailure } from './incident-client';
import { planLimitOf } from './billing/limit-events';
/** Convex transports safe application errors in data; never show its server stack. */
export function userErrorMessage(error:unknown,fallback='This action could not finish. Please retry.'):string {
  if(error&&typeof error==='object'&&'data' in error) {
    const data=error.data;
    if(typeof data==='string')return data;
    if(data&&typeof data==='object'&&'message' in data&&typeof data.message==='string')return data.message;
  }
  if(error instanceof Error&&!/\[CONVEX|Server Error|Uncaught|\bat .*\(.+:\d+/.test(error.message))return error.message;
  return fallback;
}

/** Capture a surfaced operation failure once, then format its safe message. */
export function userError(error:unknown,fallback='This action could not finish. Please retry.'):string {
  // A plan limit (storage full, AI usage used up) is not a failure; the Convex client already opened the upgrade dialog.
  if(!planLimitOf(error))reportClientFailure(error);
  return userErrorMessage(error,fallback);
}

/** Deleted, foreign, and malformed project ids share one typed Convex error. */
export function isProjectNotFound(error:unknown):boolean {
  return userErrorMessage(error,'')==='Project not found';
}
