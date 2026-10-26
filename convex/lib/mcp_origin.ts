// The MCP server answers on Convex's own site URL and, through the website's proxy,
// on MCP_PUBLIC_ORIGIN (https://tryrevline.com). Discovery documents name whichever
// address the client used, since clients check the resource against it.
const convexSite = () => process.env.CONVEX_SITE_URL ?? '';
export const publicMcpOrigin = () => process.env.MCP_PUBLIC_ORIGIN?.replace(/\/$/, '') || convexSite();
/** Set by the website's proxy (proxy.ts). Spoofing it only changes which of our own addresses is advertised. */
export const MCP_ORIGIN_HEADER = 'x-revline-mcp-origin';
export const requestMcpOrigin = (request: Request) => request.headers.get(MCP_ORIGIN_HEADER) === publicMcpOrigin() ? publicMcpOrigin() : convexSite();
export const mcpOrigins = () => [...new Set([publicMcpOrigin(), convexSite()])];
