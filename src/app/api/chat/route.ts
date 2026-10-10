import { requestError } from "@/lib/request-guard";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { missingAsset, assertProject, projectSchema } from "@/lib/project";
import { demoEdit } from "@/lib/demo-engine";
export const runtime = "nodejs";
const requestSchema = z.object({ prompt: z.string().trim().min(1).max(4000), project: z.unknown().transform(assertProject), selectedId: z.string().nullable(), mode: z.enum(["demo", "ai"]), apiKey: z.string().max(300).optional(), model: z.string().min(1).max(100).optional(), assets: z.array(z.object({ id: z.string().max(80), name: z.string().max(120), role: z.enum(["logo", "screenshot", "background"]) })).max(8), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(5000) })).max(12) });
const resultSchema = z.object({ message: z.string().max(1200), project: projectSchema });
export function GET() { return NextResponse.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-4.1" }); }
export async function POST(request: Request) {
  const rejected = requestError(request); if (rejected) return rejected;
  if (Number(request.headers.get("content-length")) > 100_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 100_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const input = requestSchema.parse(JSON.parse(text));
    assertProject(input.project);
    if (input.mode === "demo") return NextResponse.json({ ...demoEdit(input.prompt, input.project, input.selectedId), source: "demo" });
    const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Connect an OpenAI API key in Model settings, or switch to the local demo engine." }, { status: 401 });
    const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });
    const response = await client.responses.parse({
      model: input.model || process.env.OPENAI_MODEL || "gpt-4.1", store: false,
      instructions: `You are a motion designer building short, polished product demos. Return the complete project plus a concise description of the changes. You can compose title, logo, screenshot, feature (screenshot with cursor and callout), cards, chart, workflow, composer, result, and outro scenes. composer animates subtitle as a typed prompt: a composer slides sideways, zooms to Send and clicks, then result can reveal the output. Give composer 5-8 seconds for readable typing. Plan a clear narrative, short readable copy, varied pacing, a strong opening, and a closing. Use real product names and features from the user; do not invent numerical claims. chart values are 0-100. Items supply the actual cards, workflow steps, chart bars, or feature callout. Keep at least one and at most 12 scenes; each lasts 1-12 seconds; total video <=120 seconds. Keep all scene IDs unique and stable on edits. Only change what the user requested, preserving other scenes and settings. Selected scene is the target for 'this scene'. Assets are IDs: only reference supplied IDs, using screenshot assets for product/feature scenes and logo assets for logo scenes. If user requests an unsupported feature, explain the limit and preserve their work. Supported styles studio (neutral dark), paper (neutral light), electric (high contrast black). Default to minimal monochrome design. Preserve neutral accents unless the user requests color. All six-digit hex accent colors are allowed. Aspect landscape, portrait, square. Every scene has a design object: layout editorial/centered/full-bleed, reveal lines/words/fade, easing cinematic/ease-out/linear/spring, stagger seconds 0-.3, motionBlur boolean (velocity-based softening), background plain/grid/orbit, backgroundAssetId nullable, camera mode static/push-in/pull-back/pan-left/pan-right/focus and strength/focusX/focusY 0-1. For composer, focus means the Send close-up and static disables it. Transitions cut/dissolve/wipe/push/zoom apply at the incoming shot and do not change total duration. duration is seconds 0-1.2. Design.layers allows up to 6 independent text/rect/ellipse/image overlays. Layer x/y keyframes are normalized canvas coordinates; at is normalized shot time 0-1, strictly increasing. Supply complete keyframe poses x,y,scale,rotation,opacity,blur,easing; at least 2 keys and at most 8. Layer fontSize is a fraction of canvas height. Layer width/height are fractions of canvas size. Image layer assetId must exist. Other layer assetId may be null. color is ink/muted/accent/surface or hex. Project soundtrack silent/ambient/pulse. Preserve the existing soundtrack unless asked. Use layered composition and meaningful camera moves, with holds for readability. No code generation. Current project, selection, asset catalog follow in the user context.`,
      input: [ { role: "user", content: `Current context: ${JSON.stringify({ project: input.project, selectedId: input.selectedId, assets: input.assets })}` }, ...input.history, { role: "user", content: input.prompt } ],
      text: { format: zodTextFormat(resultSchema, "motion_design") },
    });
    if (!response.output_parsed) throw new Error("The model didn’t return a composition. Try a more specific request.");
    const project = assertProject(response.output_parsed.project);
    if (missingAsset(project, input.assets)) throw new Error("The model referenced an unavailable asset. Please try again.");
    return NextResponse.json({ project, message: response.output_parsed.message, source: "ai" });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid composition or request. Check scene lengths and fields." }, { status: 400 });
    if (error instanceof OpenAI.APIError) return NextResponse.json({ error: error.status === 401 ? "The API key was rejected. Check your key in Model settings." : error.status === 429 ? "The model’s quota or rate limit was reached. Check your API billing or retry shortly." : `The model request failed (${error.status || "connection error"}). Check the model name and try again.` }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate a composition" }, { status: 400 });
  }
}
