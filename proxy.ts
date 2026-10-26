import { clerkMiddleware } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const clerk = clerkMiddleware();

// The MCP server and its OAuth endpoints run on Convex; tryrevline.com/mcp passes them
// through so clients only ever see Revline's own domain (see convex/lib/mcp_origin.ts).
const MCP_PATHS = /^\/(?:mcp|oauth\/(?:authorize|token|register|revoke)|\.well-known\/(?:oauth-protected-resource|oauth-authorization-server)(?:\/mcp)?|\.well-known\/openid-configuration)$/;

async function forwardToMcp(request: NextRequest) {
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, process.env.NEXT_PUBLIC_CONVEX_SITE_URL);
  const headers = new Headers(request.headers);
  for (const name of ['host', 'cookie', 'content-length']) headers.delete(name);
  headers.set('x-revline-mcp-origin', request.nextUrl.origin);
  const client = request.headers.get('cf-connecting-ip');
  if (client) headers.set('x-forwarded-for', client);
  const response = await fetch(target, { method: request.method, headers, redirect: 'manual', ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: await request.arrayBuffer() }) });
  // fetch already decoded the body.
  const out = new Headers(response.headers);
  for (const name of ['content-encoding', 'content-length', 'transfer-encoding']) out.delete(name);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return MCP_PATHS.test(request.nextUrl.pathname) ? forwardToMcp(request) : clerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
