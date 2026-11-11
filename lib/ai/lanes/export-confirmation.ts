/**
 * Posting authorization comes from the user's own request, never from a tool argument alone: over MCP, confirm: true
 * only counts in a task whose request asked to post, publish or schedule. (In the editor the user presses a card.)
 */
export function postRequested(request: string): boolean {
  // A posting verb with somewhere to post ("upload this to my YouTube"), or "post/publish/schedule" aimed at the clip itself.
  const asks = /\b(?:post(?:ing)?|publish(?:ing)?|schedul(?:e|ing)|re-?schedul(?:e|ing)|upload(?:ing)?|share|go live)\b/i, place = /\b(?:tik\s?tok|instagram|insta|ig|youtube|yt|accounts?|channels?|socials?|social media)\b|@[\w.]+/i;
  return (asks.test(request) && place.test(request) || /\b(?:post|publish|schedule)\s+(?:it|this|that|these|those|them|the|all|both|every|each|my|now)\b/i.test(request))
    // Only a refusal of posting itself: "don't post it yet", "without publishing".
    && !/\b(?:never|don't|do not|don’t|not to|without)\s+(?:\w+\s+){0,2}(?:post|publish|schedul|upload)/i.test(request);
}

/** Export authorization comes from the current user request, never a tool-supplied confirmation flag. */
export function exportConfirmed(request: string): boolean {
  return (
    /(?:^\s*(?:please\s+)?(?:export\b|render\b.{0,30}\bmp4\b)|\b(?:yes|confirmed|go ahead|please|can you|could you|would you)\b.{0,30}\bexport\b)/i.test(
      request,
    ) &&
    !/\b(?:never|no|without|don't|do not|don’t)\b.{0,60}\bexport\b/i.test(
      request,
    )
  );
}
