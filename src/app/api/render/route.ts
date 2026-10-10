import { requestError } from "@/lib/request-guard";
import { NextResponse } from "next/server";
import { z } from "zod";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { assertProject, assetsSchema, dimensions, projectSchema } from "@/lib/project";
export const runtime = "nodejs";
export const maxDuration = 600;
const schema = z.object({ project: projectSchema, assets: assetsSchema, resolution: z.enum(["720p", "1080p"]) });
export async function POST(request: Request) {
  const rejected = requestError(request); if (rejected) return rejected;
  if (Number(request.headers.get("content-length")) > 24_000_000) return NextResponse.json({ error: "Keep uploads under 15 MB total" }, { status: 413 });
  let input: z.infer<typeof schema>;
  try {
    const text = await request.text();
    if (text.length > 24_000_000) return NextResponse.json({ error: "The composition is too large" }, { status: 413 });
    input = schema.parse(JSON.parse(text));
    assertProject(input.project);
    if (input.project.scenes.some(s => s.assetId && !input.assets.some(a => a.id === s.assetId))) throw new Error("A scene references a missing asset");
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid composition or uploaded image" : error instanceof Error ? error.message : "Invalid request" }, { status: 400 }); }
  const encoder = new TextEncoder();
  const { cancel, cancelSignal } = makeCancelSignal();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => { if (!closed) { try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { closed = true; cancel(); } } };
      const abort = () => cancel(); request.signal.addEventListener("abort", abort);
      const timeout = setTimeout(cancel, 600_000);
      let directory: string | undefined;
      try {
        emit({ type: "progress", progress: 0, stage: "Preparing composition" });
        directory = await mkdtemp(join(tmpdir(), "motion-demo-"));
        const serveUrl = await bundle({ entryPoint: join(process.cwd(), "src/remotion/index.tsx"), outDir: join(directory, "bundle"), onProgress: progress => emit({ type: "progress", progress: Math.round(progress * .12), stage: "Preparing composition" }) });
        const inputProps = { project: input.project, assets: input.assets };
        const composition = await selectComposition({ serveUrl, id: "MotionDemo", inputProps });
        emit({ type: "progress", progress: 12, stage: "Rendering frames" });
        const { buffer } = await renderMedia({ serveUrl, composition: { ...composition, ...dimensions(input.project.aspect, input.resolution) }, inputProps, codec: "h264", outputLocation: null, crf: 18, concurrency: 2, cancelSignal, onProgress: ({ progress }) => emit({ type: "progress", progress: Math.round(12 + progress * 87), stage: progress > .85 ? "Encoding MP4" : "Rendering frames" }) });
        if (!buffer) throw new Error("The renderer did not return a video");
        emit({ type: "complete", video: buffer.toString("base64"), filename: `${input.project.name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 70)}.mp4` });
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : "Video export failed. Please try again." });
      } finally {
        clearTimeout(timeout); request.signal.removeEventListener("abort", abort);
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; cancel(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
