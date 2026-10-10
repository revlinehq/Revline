import { NextResponse } from "next/server";

export const runtime = "nodejs";
// A form response downloads directly, including in embedded browsers that do not
// support blob download links. No export is retained on the server.
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!origin || origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) {
    return NextResponse.json({ error: "Use the editor from this app’s own origin" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "Send an export form" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > 100_000_000) {
    return NextResponse.json({ error: "Export is too large" }, { status: 413 });
  }
  const body = await request.text();
  if (body.length > 100_000_000) return NextResponse.json({ error: "Export is too large" }, { status: 413 });
  const form = new URLSearchParams(body);
  const video = form.get("video") || "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(video)) return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  const bytes = Buffer.from(video, "base64");
  if (bytes.toString("ascii", 4, 8) !== "ftyp") return NextResponse.json({ error: "Invalid MP4" }, { status: 400 });
  const filename = (form.get("filename") || "motion-demo.mp4").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
