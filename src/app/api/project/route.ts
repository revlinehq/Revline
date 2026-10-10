import { assertProject, assetsSchema } from "@/lib/project";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== `${url.protocol}//${request.headers.get("host") || url.host}`) return Response.json({ error: "Use the editor from this app’s own origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return Response.json({ error: "Send a project form" }, { status: 415 });
  if (Number(request.headers.get("content-length")) > 30_000_000) return Response.json({ error: "Project is too large" }, { status: 413 });
  try {
    const body = await request.text();
    if (body.length > 30_000_000) return Response.json({ error: "Project is too large" }, { status: 413 });
    const data = JSON.parse(new URLSearchParams(body).get("project") || "");
    const project = assertProject(data.project); const assets = assetsSchema.parse(data.assets);
    if (project.scenes.some(s => s.assetId && !assets.some(a => a.id === s.assetId))) throw new Error("Unavailable image");
    const filename = project.name.replace(/[^a-zA-Z0-9-_]/g,"-").slice(0,70);
    return new Response(JSON.stringify({ version: 1, project, assets },null,2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${filename}.json"`, "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Invalid project" }, { status: 400 }); }
}
