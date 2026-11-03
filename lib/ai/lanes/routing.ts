import { type LaneId } from './index';
export type LaneRoutingContext = {
  request: string;
  previous?: LaneId;
  manual?: boolean;
  brief?: string;
  media?: { kind: string; duration?: number; fileName?: string }[];
};
/** Cheap local classifier: explicit request signals outrank context; terse follow-ups retain the tab's lane. */
export function routeLane(context: LaneRoutingContext): {
  lane: LaneId;
  reason: string;
} {
  const text = context.request;
  if (/^\/clip(?:\s|$)/i.test(text.trim()))
    return { lane: 'clip', reason: 'Slash command /clip' };
  if (context.manual && context.previous)
    return {
      lane: context.previous,
      reason: 'User-selected lane for this timeline',
    };
  const classify = (value: string): LaneId | undefined => {
    if (
      /\b(recreat\w*|remake|clone|copy.{0,25}(reference|motion|video)|match.{0,25}reference)\b/i.test(
        value,
      )
    )
      return 'recreate';
    if (/\b(explainer|narrated film|voiceover film)\b/i.test(value))
      return 'explainer';
    if (
      /\b(reel|talking[- ]head.{0,30}(short|edit)|30.{0,5}60.{0,10}(second|reel))\b/i.test(
        value,
      )
    )
      return 'reel';
    if (
      /\b(make clips|clip this|find.{0,15}best moments|(?:podcast|stream|vod).{0,50}(?:clips|shorts)|highlights?|shorts|clip (?:this |the |my )?(?:stream|podcast|vod)|stream.{0,30}clips)\b/i.test(
        value,
      )
    )
      return 'clip';
    if (
      /\b(motion|launch film|animation|animated scene|trailer|teaser|standalone scene)\b/i.test(
        value,
      )
    )
      return 'motion';
    return undefined;
  };
  const requested = classify(text);
  if (requested) return { lane: requested, reason: 'Request classifier' };
  if (
    /\b(?:make|turn|cut)\b.{0,50}\b(?:a short|vertical cut|social cut)\b/i.test(
      text,
    )
  ) {
    const duration = Math.max(
      0,
      ...(context.media ?? [])
        .filter((asset) => asset.kind === 'video')
        .map((asset) => asset.duration ?? 0),
    );
    if (duration > 0)
      return {
        lane: duration >= 180 ? 'clip' : 'reel',
        reason: 'Requested short format and attached source duration',
      };
  }
  if (context.previous)
    return { lane: context.previous, reason: 'Follow-up in the same timeline' };
  const contextual = classify(context.brief ?? '');
  if (contextual)
    return { lane: contextual, reason: 'Project brief classifier' };
  if (
    context.media?.some(
      (asset) => asset.kind === 'video' && (asset.duration ?? 0) >= 600,
    ) &&
    /\b(best moments|short clips)\b/i.test(text)
  )
    return {
      lane: 'clip',
      reason: 'Long attached source and clipping request',
    };
  return { lane: 'edit', reason: 'General editing default' };
}
export const requiresFinish = (request: string) =>
  !/^\s*(?:(?:hi|hello|hey|thanks|thank you)[!. ]*|(?:what|how|why|can you explain|tell me|show me the|list|describe)\b[\s\S]*\?)\s*$/i.test(
    request,
  );
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
