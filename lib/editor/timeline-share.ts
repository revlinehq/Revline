/** A share link's key: `<id>.<token>`, or the bare id for a link sent before share tokens. */
export function timelineShareKey(shareId: string, token?: string) { return token ? `${shareId}.${token}` : shareId; }
/** The token part of a link key, if it has one. */
export function timelineShareToken(key: string) { const dot = key.indexOf('.'); return dot < 0 ? undefined : key.slice(dot + 1); }
/** The public showcase page for a published timeline share. */
export function timelineSharePath(key: string) { return `/editor/showcase/${encodeURIComponent(key)}`; }
