// The MVP is a local app. Reject browser requests coming from another origin.
export function requestError(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (origin && origin !== expectedOrigin) return Response.json({ error: "Use the editor from this app’s own origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Send a JSON request" }, { status: 415 });
  return null;
}
