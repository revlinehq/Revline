import type { HttpRouter } from 'convex/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { httpAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { EDITOR_STYLE_RULES } from '../lib/ai/editor-style';
import { CLIPPING_SKILL_ROUTING } from '../lib/ai/skills/clipping';
import { MCP_ORIGIN_HEADER, requestMcpOrigin } from './lib/mcp_origin';
import { REFERENCE_COMPARISON_BUDGET_MS } from '../lib/ai/reference-comparison';

// Streamable HTTP MCP server (official MCP SDK, stateless JSON responses) plus
// the OAuth 2.1 authorization server MCP clients discover from it.
const resourceMetadataUrl = (site: string) => `${site}/.well-known/oauth-protected-resource/mcp`;
const cors = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const MCP_INSTRUCTIONS = `Keep mode, cost and method metadata in tool results. User-facing replies have zero "How it was made", "Mode" or cost footers; explain how or cost only when asked. Never approve finished work on the user’s behalf.

If a Revline tool unexpectedly fails, returns wrong or inconsistent results, or contradicts its documented contract, call reportIssue once with its name, a minimal input summary, what happened and what you expected. Never include credentials, tokens, user text or media. Do not report ordinary validation failures or unsupported requests. Continue safely and describe any unresolved limitation honestly.

Revline is a video editor. These tools edit the user's real Revline projects; each editing call is saved immediately, appears live in any open editor tab, and is undoable (undoLatestEdit, or Undo in the editor). History is kept: when the user wants back something they had ("bring back what we had", "it was better before"), call listRevisions, look at a revision with getFrames revision, then restoreSection (one section of a film, the rest stays as it is now) or restoreClip (one whole clip, keeping every later edit to the others). Never chain undoLatestEdit to reach an older version.

For edits to existing footage, audio, captions, scenes or films, start with readSkill name "scene-engine" page "edit-lanes" and follow its workflow. Default workflow: listProjects -> getProject (read its brief: the user's direction for this project, and follow it) -> inspectTimeline (same projectId) -> edit -> inspectTimeline again to confirm. When the user gives lasting direction, record it with updateBrief. Edits to a film with several sections pass scope, the section the user asked about; every other section is locked. Use getFrames to see the composited result at a few timeline seconds after visual changes (captions, framing, effects). Every editing tool needs projectId. Clip IDs, asset IDs and times come only from inspectTimeline, inspectClip, getProject and inspectAssetAnalysis; never invent them. Timeline times are seconds on the timeline; tools that say SOURCE seconds mean time inside the original media.
${CLIPPING_SKILL_ROUTING}
Before speech cuts, captions or take selection, read the relevant SOURCE transcript range with inspectAssetAnalysis (run analyzeMedia mode "transcribe" first if no transcript is saved). Use readSkill for detailed guidance on a kind of edit. Batch known edits when the tool supports it; a failed call saves nothing. If another edit is running on the project, wait and retry.
Bring in footage with uploadMedia (a local file: run the script it returns, then finishUpload) or importVideoLink (a URL).

Use Revline's tools, not your own scripts. Never run ffmpeg, Python or other code of your own to look at, measure or time video or audio: every script means a Revline tool was skipped, and its result never reaches the project.
- Recreating or learning from a reference video: uploadMedia it into the project (it need not go on the timeline), then readFrames (the whole video in 16 frames, then short windows around each move, then crops to read type and icons), trackReference for each moving object (it returns each move as a GSAP tween with its timing and ease), and measureFrame for exact colors, sizes and edges. Every brand logo or app icon comes from findIcon (the official SVG), and hand-made shapes (brush strokes, torn paper) from traceShape; never draw either by hand. After building, compareReference sets the reference beside your timeline at each moment with a difference score; fix the worst first. For a demo sub-panel beside other reference content, set referenceCrop and leave timelineCrop full-frame; do not reposition your film inside a copy of the reference. Use referenceCropKeyframes in SOURCE seconds when that panel moves. compareMotion accepts the same independent crops.
- Removing awkward moments from footage (dead air, looking away, reaching for the camera): readSkill visual-inspection. readFrames momentsOnly maps the whole clip, then readFrames fps 10 confirms each candidate before you cut.
- Music and timing: markMusicBeats for beats, downbeats and drops, and alignCutsToBeat to cut on them. Sound effects: generateSound, keyed to the motion.
- Narration: listVoices (with sampleText for playable samples) and generateVoice, which places the voice and returns every word's timeline time. A narrated explainer film follows the explainer skill.
- Before building motion, readSkill the matching skill (motion-design for launch films and any standalone motion scene, explainer-scenes for explainers over footage, scene-engine for any scene) and follow it. Check your work with getFrames, and run checkPacing on the range for builds or full-lane motion edits: stills cannot show speed. For builds or full-lane sound edits, run checkSound on that range (getSound to hear what plays where).
Share the editorUrl from getProject so the user can watch. Export with exportVideo and poll getExport for the download link. For several separate videos in one project, use timeline tabs (listTimelines, createTimeline, openTimeline; editing tools act on the open tab) and export each with exportVideo timelineId. Exports queue, and listExports shows them all.

Editing quality rules:
${EDITOR_STYLE_RULES}`;

const oauthMetadata = (site: string) => ({
  issuer: site, authorization_endpoint: `${site}/oauth/authorize`, token_endpoint: `${site}/oauth/token`, registration_endpoint: `${site}/oauth/register`, revocation_endpoint: `${site}/oauth/revoke`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: ['revline'],
});
const resourceMetadata = (site: string) => ({ resource: `${site}/mcp`, authorization_servers: [site], bearer_methods_supported: ['header'], scopes_supported: ['revline'], resource_name: 'Revline video editor' });

let toolCatalog: Promise<Tool[]> | undefined;
const withCors = (response: Response) => { const headers = new Headers(response.headers); for (const [key, value] of Object.entries(cors)) headers.set(key, value); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };

/** The official MCP SDK speaks the protocol; Revline supplies auth, the tool list and tool calls. */
function revlineServer(ctx: ActionCtx, ownerId: string, agentName: string, comparisonDeadline: number) {
  const server = new Server({ name: 'revline', title: 'Revline', version: '1.0.0' }, { capabilities: { tools: { listChanged: false } }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    toolCatalog ??= ctx.runAction(internal.mcpActions.listTools, {}).then(tools => tools as Tool[]).catch(error => { toolCatalog = undefined; throw error; });
    return { tools: await toolCatalog };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const outcome = await ctx.runAction(internal.mcpActions.callTool, { ownerId, agentName, name: request.params.name, arguments: request.params.arguments ?? {}, ...(request.params.name === 'compareReference' ? { comparisonDeadline } : {}) });
    return { content: [{ type: 'text' as const, text: outcome.text }, ...(outcome.images ?? []).map(image => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType }))], isError: outcome.isError };
  });
  return server;
}

const mcpHandler = httpAction(async (ctx, request) => {
  const comparisonDeadline = Date.now() + REFERENCE_COMPARISON_BUDGET_MS;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  // MCP 2025-06-18 removed JSON-RPC batching; one message per request keeps rate limits exact.
  if (Array.isArray(body)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one JSON-RPC message per request.' } }, 400);
  const method = body && typeof body === 'object' ? (body as { method?: unknown }).method : undefined;
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  const challenge = (error?: string) => `Bearer resource_metadata="${resourceMetadataUrl(requestMcpOrigin(request))}"${error ? `, error="${error}"` : ''}`;
  if (!token) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to Revline to use this connector.' } }, 401, { 'WWW-Authenticate': challenge() });
  const auth = await ctx.runMutation(internal.mcpAuth.authenticate, { token, calls: method === 'tools/call' ? 1 : 0 });
  if ('error' in auth) {
    if (auth.error === 'invalid_token') return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'This Revline connection expired or was revoked. Connect again.' } }, 401, { 'WWW-Authenticate': challenge('invalid_token') });
    if (auth.error === 'rate_limited') return json({ jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Too many tool calls. Wait a minute and retry.' } }, 429, { 'Retry-After': '60' });
    return json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: 'The Revline MCP connector is part of the Ultra plan.' } }, 403);
  }
  // Stateless: a fresh server and transport per request, answering with JSON rather than an event stream.
  const server = revlineServer(ctx, auth.ownerId, auth.clientName, comparisonDeadline);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request, { parsedBody: body }));
  } finally { await server.close(); }
});

function formValues(text: string, contentType: string | null): Record<string, string> {
  if (contentType?.includes('application/json')) { try { const value = JSON.parse(text); return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) as Record<string, string> : {}; } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(text));
}

export function registerMcpRoutes(http: HttpRouter) {
  const options = httpAction(async () => new Response(null, { status: 204, headers: cors }));
  // Stateless JSON server: no standalone event stream and no sessions to delete.
  const notStreaming = httpAction(async () => new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } }));
  http.route({ path: '/mcp', method: 'POST', handler: mcpHandler });
  http.route({ path: '/mcp', method: 'GET', handler: notStreaming });
  http.route({ path: '/mcp', method: 'DELETE', handler: notStreaming });

  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    http.route({ path, method: 'GET', handler: httpAction(async (_ctx, request) => json(resourceMetadata(requestMcpOrigin(request)))) });
    http.route({ path, method: 'OPTIONS', handler: options });
  }
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration']) {
    http.route({ path, method: 'GET', handler: httpAction(async (_ctx, request) => json(oauthMetadata(requestMcpOrigin(request)))) });
    http.route({ path, method: 'OPTIONS', handler: options });
  }
  for (const path of ['/mcp', '/oauth/register', '/oauth/token', '/oauth/revoke']) http.route({ path, method: 'OPTIONS', handler: options });

  http.route({ path: '/oauth/register', method: 'POST', handler: httpAction(async (ctx, request) => {
    let metadata: Record<string, unknown>;
    const text = await request.text();
    if (text.length > 20_000) return json({ error: 'invalid_client_metadata', error_description: 'Client metadata is too large.' }, 400);
    try { metadata = JSON.parse(text); } catch { return json({ error: 'invalid_client_metadata', error_description: 'Send client metadata as JSON.' }, 400); }
    const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((uri): uri is string => typeof uri === 'string') : [];
    // Through the website's proxy every request shares its egress address, so the proxy
    // forwards the caller's address in X-Forwarded-For.
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const source = (request.headers.has(MCP_ORIGIN_HEADER) ? forwarded : request.headers.get('cf-connecting-ip') ?? forwarded) ?? 'unknown';
    const client = await ctx.runMutation(internal.mcpAuth.registerClient, { clientName: typeof metadata.client_name === 'string' ? metadata.client_name : 'MCP client', redirectUris, source });
    if ('error' in client) return client.error === 'rate_limited' ? json({ error: 'slow_down', error_description: 'Too many registrations. Try again in a minute.' }, 429, { 'Retry-After': '60' }) : json({ error: 'invalid_redirect_uri', error_description: 'Use https, loopback http or an app scheme redirect, up to 10.' }, 400);
    return json({ client_id: client.clientId, client_id_issued_at: Math.floor(client.createdAt / 1000), client_name: typeof metadata.client_name === 'string' ? metadata.client_name.slice(0, 100) : 'MCP client', redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }, 201);
  }) });

  http.route({ path: '/oauth/authorize', method: 'GET', handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const clientId = params.get('client_id') ?? '', redirectUri = params.get('redirect_uri') ?? '';
    // Never redirect to an address the client did not register.
    if (!clientId || !redirectUri || !await ctx.runQuery(internal.mcpAuth.checkAuthorizeRequest, { clientId, redirectUri })) return new Response('Unknown app or redirect address. Remove and add the Revline connector again.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    const back = (error: string, description: string) => {
      const target = new URL(redirectUri);
      target.searchParams.set('error', error); target.searchParams.set('error_description', description);
      if (params.get('state') !== null) target.searchParams.set('state', params.get('state')!);
      return new Response(null, { status: 302, headers: { Location: target.toString() } });
    };
    if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'Only the authorization code flow is supported.');
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) return back('invalid_request', 'PKCE with S256 is required.');
    const consent = new URL(`${process.env.APP_ORIGIN}/connect`);
    for (const key of ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'resource']) { const value = params.get(key); if (value !== null) consent.searchParams.set(key, value); }
    return new Response(null, { status: 302, headers: { Location: consent.toString() } });
  }) });

  http.route({ path: '/oauth/token', method: 'POST', handler: httpAction(async (ctx, request) => {
    const form = formValues(await request.text(), request.headers.get('Content-Type'));
    const clientId = form.client_id ?? '';
    if (!clientId) return json({ error: 'invalid_client', error_description: 'client_id is required.' }, 401);
    const outcome = form.grant_type === 'authorization_code'
      ? await ctx.runMutation(internal.mcpAuth.exchangeCode, { code: form.code ?? '', clientId, redirectUri: form.redirect_uri ?? '', codeVerifier: form.code_verifier ?? '', ...(form.resource ? { resource: form.resource } : {}) })
      : form.grant_type === 'refresh_token'
        ? await ctx.runMutation(internal.mcpAuth.refreshTokens, { refreshToken: form.refresh_token ?? '', clientId })
        : { error: 'unsupported_grant_type', error_description: 'Use authorization_code or refresh_token.' };
    return json(outcome, 'error' in outcome ? 400 : 200, { Pragma: 'no-cache' });
  }) });

  http.route({ path: '/oauth/revoke', method: 'POST', handler: httpAction(async (ctx, request) => {
    const form = formValues(await request.text(), request.headers.get('Content-Type'));
    if (form.token) await ctx.runMutation(internal.mcpAuth.revokeToken, { token: form.token });
    return new Response(null, { status: 200, headers: cors });
  }) });
}
