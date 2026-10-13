/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workflowTest from "@convex-dev/workflow/test";
import { createThread, saveMessage } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { boundedHistory, serializedBytes } from "./lib/timeline";
import { normalizeTimeline, type Timeline } from "../lib/editor/types";
import { focusForClip } from "../lib/editor/operations";
import { summarizeTimeline } from "./lib/inspectTimeline";
const modules = import.meta.glob("./**/*.ts");
const identity = (subject: string) => ({ subject, issuer: "https://test.clerk.accounts.dev", tokenIdentifier: `https://test.clerk.accounts.dev|${subject}` });
const makeTest = () => { const t = convexTest(schema, modules); workflowTest.register(t); return t; };
type Test = ReturnType<typeof makeTest>;
const textTimeline: Timeline = normalizeTimeline({ clips: [{ id: "caption-1", kind: "caption", start: 0, duration: 3, sourceStart: 0, text: "Hello" }], fps: 30, aspectRatio: "vertical" });
async function uploadedFile(t: Test, ownerId: string, projectId: Id<"projects">, contentType = "video/mp4", jobId?: Id<"renderJobs">, ticketOwner = ownerId) {
  return await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["sample media"], { type: contentType }));
    // convex-test's storage mock omits Content-Type metadata supplied by real uploads.
    // @ts-expect-error Seed system metadata only in the upload fixture.
    await ctx.db.patch(storageId, { contentType });
    await ctx.db.insert("uploadTickets", { token: `fixture-${storageId}`, ownerId: ticketOwner, projectId, ...(jobId ? { jobId } : {}), storageId, expiresAt: Date.now() + 60000, consumed: false });
    return storageId;
  });
}
async function project(t: Test, ownerId = "owner") { return await t.withIdentity(identity(ownerId)).mutation(api.projects.create, { title: "My reel", aspectRatio: "vertical" }); }
beforeEach(() => { vi.stubEnv("RENDER_WORKER_SECRET", "test-worker-secret"); vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site"); vi.stubEnv("BILLING_ENABLED", "false"); vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("AI_GATEWAY_ENABLED", "false"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("project and media ownership", () => {
  test("rejects unauthenticated project access and upload generation", async () => {
    const t = makeTest();
    await expect(t.mutation(api.projects.create, { title: "My reel", aspectRatio: "vertical" })).rejects.toThrow("Authentication required");
    await expect(t.query(api.projects.list, {})).rejects.toThrow("Authentication required");
    await expect(t.mutation(api.assets.generateUploadUrl, { projectId: await project(t) })).rejects.toThrow("Authentication required");
  });
  test("rejects another user's reads, writes, uploads and media association", async () => {
    const t = makeTest(); const projectId = await project(t); const stranger = t.withIdentity(identity("stranger")); const storageId = await uploadedFile(t, "owner", projectId);
    await expect(stranger.query(api.projects.get, { projectId })).rejects.toThrow("Project not found");
    await expect(stranger.mutation(api.projects.update, { projectId, title: "Hijacked" })).rejects.toThrow("Project not found");
    await expect(stranger.mutation(api.assets.generateUploadUrl, { projectId })).rejects.toThrow("Project not found");
    await expect(stranger.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video" })).rejects.toThrow("Project not found");
    await expect(stranger.query(api.assets.list, { projectId })).rejects.toThrow("Project not found");
    expect(await stranger.query(api.projects.list, {})).toEqual([]);
  });
  test("binds upload IDs to ticket owners even when another user knows the ID", async () => {
    const t = makeTest(); const projectId = await project(t); const otherProjectId = await project(t, "stranger"); const storageId = await uploadedFile(t, "owner", projectId);
    await expect(t.withIdentity(identity("stranger")).mutation(api.assets.create, { projectId: otherProjectId, storageId, fileName: "stolen.mp4", kind: "video" })).rejects.toThrow("Uploaded file does not belong to this request");
    const owner = t.withIdentity(identity("owner"));
    await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 8, width: 1920, height: 1080 });
    expect(await owner.query(api.assets.list, { projectId })).toEqual([expect.objectContaining({ ownerId: "owner", contentType: "video/mp4", size: 12, duration: 8, url: expect.any(String) })]);
    await expect(owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video" })).rejects.toThrow("File is already attached");
  });
  test("rejects native uploads without ownership tickets and invalid file metadata", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    const storageId = await uploadedFile(t, "owner", projectId);
    await t.run(async ctx => { const ticket = await ctx.db.query("uploadTickets").withIndex("by_storageId", q => q.eq("storageId", storageId)).unique(); await ctx.db.delete(ticket!._id); });
    await expect(owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video" })).rejects.toThrow("Uploaded file does not belong");
    const textId = await uploadedFile(t, "owner", projectId, "text/plain");
    await expect(owner.mutation(api.assets.create, { projectId, storageId: textId, fileName: "clip.mp4", kind: "video" })).rejects.toThrow("File content type");
    await expect(owner.query(api.projects.list, { limit: 101 })).rejects.toThrow("Limit must be an integer");
  });
});
describe("timeline persistence", () => {
  test("project lists send summaries without timeline or undo-history payloads", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: textTimeline, expectedRevision: 0 });
    const summaries = await owner.query(api.projects.list, {});
    expect(summaries[0]).toMatchObject({ _id: projectId, clipCount: 1 });
    expect(summaries[0]).not.toHaveProperty('timeline');
    expect(summaries[0]).not.toHaveProperty('history');
    expect((await owner.query(api.projects.get, { projectId })).history).toHaveLength(1);
  });
  test("uses compare-and-swap and records one undo snapshot per save", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    expect(await owner.mutation(api.projects.saveTimeline, { projectId, timeline: textTimeline, expectedRevision: 0 })).toEqual({ revision: 1, timeline: textTimeline });
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...textTimeline, aspectRatio: "square" }, expectedRevision: 0 })).rejects.toThrow("timeline changed elsewhere");
    expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(textTimeline);
    expect(await owner.mutation(api.projects.undo, { projectId })).toBe(2);
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips).toEqual([]);
    await expect(owner.mutation(api.projects.undo, { projectId })).rejects.toThrow("No edits to undo");
  });
  test("rejects unknown assets, foreign assets and source trims beyond media duration", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    const storageId = await uploadedFile(t, "owner", projectId);
    const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
    const timeline: Timeline = { ...textTimeline, clips: [{ id: "clip-1", kind: "video", assetId, start: 0, duration: 3, sourceStart: 4 }] };
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline, expectedRevision: 0 })).rejects.toThrow("Source trim extends");
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...timeline, clips: [{ ...timeline.clips[0], assetId: "unknown", sourceStart: 0 }] }, expectedRevision: 0 })).rejects.toThrow("Clip media must belong");
    const stranger = t.withIdentity(identity("stranger")); const otherProjectId = await project(t, "stranger");
    await expect(stranger.mutation(api.projects.saveTimeline, { projectId: otherProjectId, timeline: { ...timeline, clips: [{ ...timeline.clips[0], sourceStart: 0 }] }, expectedRevision: 0 })).rejects.toThrow("Clip media must belong");
    expect((await owner.query(api.projects.get, { projectId })).revision).toBe(0);
  });
  test("refuses malformed clip timing and duplicate clip IDs atomically", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...textTimeline, clips: [{ ...textTimeline.clips[0], start: -1 }] }, expectedRevision: 0 })).rejects.toThrow("Clip timing");
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...textTimeline, clips: [textTimeline.clips[0], textTimeline.clips[0]] }, expectedRevision: 0 })).rejects.toThrow("Clip IDs");
    expect((await owner.query(api.projects.get, { projectId })).revision).toBe(0);
  });
});
describe("render lifecycle", () => {
  test("requires worker authentication, owner identity, and job-bound output; completed jobs cannot regress", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: textTimeline, expectedRevision: 0 });
    const jobId = await owner.mutation(api.renders.start, { projectId, resolution: 1080, fps: 30, quality: "standard" });
    await expect(owner.mutation(api.renders.claim, { jobId, workerSecret: "wrong" })).rejects.toThrow("worker authentication");
    await expect(t.withIdentity(identity("stranger")).mutation(api.renders.claim, { jobId, workerSecret: "test-worker-secret" })).rejects.toThrow("Render not found");
    const worker = { jobId, workerSecret: "test-worker-secret" };
    expect((await owner.mutation(api.renders.claim, worker)).timeline).toEqual(textTimeline);
    await expect(owner.mutation(api.renders.claim, worker)).rejects.toThrow("cannot be claimed");
    await owner.mutation(api.renders.progress, { ...worker, progress: 30 });
    await expect(owner.mutation(api.renders.progress, { ...worker, progress: 20 })).rejects.toThrow("must increase");
    const unboundId = await uploadedFile(t, "owner", projectId);
    await expect(owner.mutation(api.renders.complete, { ...worker, storageId: unboundId })).rejects.toThrow("Uploaded file does not belong");
    const outputId = await uploadedFile(t, "owner", projectId, "video/mp4", jobId);
    await owner.mutation(api.renders.complete, { ...worker, storageId: outputId });
    expect(await owner.query(api.renders.get, { jobId })).toMatchObject({ status: "completed", progress: 100, url: expect.any(String) });
    await expect(owner.mutation(api.renders.fail, { ...worker, error: "late" })).rejects.toThrow("already finished");
    await expect(owner.mutation(api.renders.progress, { ...worker, progress: 99 })).rejects.toThrow("not running");
  });
  test("keeps render snapshots immutable when the project is edited later", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: textTimeline, expectedRevision: 0 });
    const jobId = await owner.mutation(api.renders.start, { projectId, resolution: 720, fps: 24, quality: "draft" });
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...textTimeline, aspectRatio: "square" }, expectedRevision: 1 });
    expect((await owner.mutation(api.renders.claim, { jobId, workerSecret: "test-worker-secret" })).timeline.aspectRatio).toBe("vertical");
  });
});
describe("inactive providers", () => {
  test("rejects missing Claude credentials before creating a thread or scheduling a run", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    expect(await owner.query(api.assistant.status, { projectId })).toMatchObject({ configured: false, running: false });
    await expect(owner.mutation(api.assistant.send, { projectId, prompt: "Cut my clip" })).rejects.toThrow("ANTHROPIC_API_KEY");
    expect((await owner.query(api.projects.get, { projectId })).threadId).toBeUndefined();
    await expect(t.withIdentity(identity("stranger")).query(api.assistant.messages, { projectId, threadId: "foreign-thread", paginationOpts: { cursor: null, numItems: 20 } })).rejects.toThrow("Project not found");
  });
  test("disabled billing performs zero Stripe network calls and rejects webhook processing", async () => {
    const fetch = vi.spyOn(globalThis, "fetch"); const t = makeTest(); const owner = t.withIdentity(identity("owner"));
    expect(await owner.query(api.billing.status, {})).toEqual({ enabled: false, configured: false, subscribed: false, trialEligible: true, needsPayment: false, plan: "free" });
    expect(await owner.query(api.billing.isSubscribed, {})).toBe(false);
    await expect(owner.action(api.billing.createCheckout, { plan: "pro" })).rejects.toThrow("Billing is not active");
    await expect(owner.action(api.billing.createPortal, {})).rejects.toThrow("Billing is not active");
    const result = await t.fetch("/stripe/webhook", { method: "POST", body: "untrusted event" }); expect(result.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("live AI checkpoints and media analysis", () => {
  test("stopping an AI run preserves saved edits and refuses later checkpoints", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity('owner'));
    await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: 'run-stop', aiUndoRecorded: false }));
    const run = { projectId, ownerId: 'owner', runId: 'run-stop' };
    await t.mutation(internal.assistant.apply, { ...run, expectedRevision: 0, timeline: textTimeline });
    await expect(t.withIdentity(identity('stranger')).mutation(api.assistant.stop, { projectId })).rejects.toThrow('Project not found');
    await owner.mutation(api.assistant.stop, { projectId });
    await expect(t.mutation(internal.assistant.apply, { ...run, expectedRevision: 1, timeline: { ...textTimeline, clips: [] } })).rejects.toThrow('no longer active');
    await t.mutation(internal.assistant.finish, { ...run, error: 'Late failure from a canceled run' });
    expect(await owner.query(api.assistant.status, { projectId })).toMatchObject({ running: false, error: null });
    expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(textTimeline);
    await owner.mutation(api.projects.undo, { projectId });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips).toEqual([]);
  });
  test("saves every AI checkpoint live while grouping undo into one snapshot", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "run-1", aiUndoRecorded: false }));
    const run = { projectId, ownerId: "owner", runId: "run-1" };
    expect(await t.mutation(internal.assistant.apply, { ...run, timeline: textTimeline, expectedRevision: 0 })).toBe(1);
    expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(textTimeline);
    const second: Timeline = { ...textTimeline, aspectRatio: "square" };
    expect(await t.mutation(internal.assistant.apply, { ...run, timeline: second, expectedRevision: 1 })).toBe(2);
    expect((await owner.query(api.projects.get, { projectId })).history).toHaveLength(1);
    await owner.mutation(api.projects.undo, { projectId });
    expect((await owner.query(api.projects.get, { projectId })).timeline?.clips).toEqual([]);
  });
  test("AI checkpoints cannot overwrite a newer manual edit", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
    await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "run-1", aiUndoRecorded: false }));
    await t.mutation(internal.assistant.apply, { projectId, ownerId: "owner", runId: "run-1", timeline: textTimeline, expectedRevision: 0 });
    await owner.mutation(api.projects.saveTimeline, { projectId, timeline: { ...textTimeline, aspectRatio: "landscape" }, expectedRevision: 1 });
    await expect(t.mutation(internal.assistant.apply, { projectId, ownerId: "owner", runId: "run-1", timeline: { ...textTimeline, aspectRatio: "square" }, expectedRevision: 1 })).rejects.toThrow("timeline changed elsewhere");
    expect((await owner.query(api.projects.get, { projectId })).aspectRatio).toBe("landscape");
  });
  test("saves owned focus metadata and validates source-relative bounds", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner")); const storageId = await uploadedFile(t, "owner", projectId);
    const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
    const focus = [{ time: 0, x: 0.25, y: 0.5 }, { time: 4, x: 0.75, y: 0.5 }];
    await owner.mutation(api.assets.saveFocus, { projectId, assetId, focus });
    expect((await owner.query(api.assets.get, { projectId, assetId })).analysis?.focus).toEqual(focus);
    await expect(t.withIdentity(identity("stranger")).mutation(api.assets.saveFocus, { projectId, assetId, focus })).rejects.toThrow("Project not found");
    await expect(owner.mutation(api.assets.saveFocus, { projectId, assetId, focus: [{ time: 7, x: 0.5, y: 0.5 }] })).rejects.toThrow("Invalid subject tracking");
    await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, clips: [{ id: "video", kind: "video", assetId, start: 0, duration: 5, sourceStart: 0, focus: [{ time: 0, x: 1.1, y: 0.5 }] }] } })).rejects.toThrow("Invalid subject tracking");
  });
  test("server-only transcript persistence enforces ownership and valid timestamps", async () => {
    const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner")); const storageId = await uploadedFile(t, "owner", projectId);
    const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
    const transcript = { segments: [{ start: 0, end: 2, text: "Hello there" }], words: [{ start: 0, end: 0.8, text: "Hello" }, { start: 0.8, end: 2, text: "there" }] };
    await expect(owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: "wrong", transcript })).rejects.toThrow("worker authentication");
    await owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: "test-worker-secret", transcript });
    expect((await owner.query(api.assets.get, { projectId, assetId })).analysis?.transcript).toEqual(transcript);
    await expect(owner.mutation(api.assets.saveAnalysis, { projectId, assetId, workerSecret: "test-worker-secret", transcript: { segments: [{ start: 3, end: 2, text: "Invalid" }], words: [] } })).rejects.toThrow("Invalid transcript timing");
  });
});

test("owned durable chat supports UI pagination and zero-item stream queries", async () => {
  const t = makeTest(); agentTest.register(t); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const threadId = await t.run(async ctx => {
    const id = await createThread(ctx, components.agent, { userId: "owner" });
    await saveMessage(ctx, components.agent, { threadId: id, userId: "owner", prompt: "Make the captions gold" });
    await ctx.db.patch(projectId, { threadId: id }); return id;
  });
  const page = await owner.query(api.assistant.messages, { projectId, threadId, paginationOpts: { cursor: null, numItems: 20 } });
  expect(page.page).toHaveLength(1); expect(page.page[0]).toMatchObject({ role: "user", text: "Make the captions gold" });
  const stream = await owner.query(api.assistant.messages, { projectId, threadId, paginationOpts: { cursor: null, numItems: 0 }, streamArgs: { kind: "list", startOrder: 0 } });
  expect(stream.streams).toEqual({ kind: "list", messages: [] });
  await expect(owner.query(api.assistant.messages, { projectId, threadId: "wrong-thread", paginationOpts: { cursor: null, numItems: 20 } })).rejects.toThrow("Conversation not found");
});

test("timeline and undo history stay under Convex document limits", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const oversized: Timeline = { ...textTimeline, clips: Array.from({ length: 100 }, (_, i) => ({ ...textTimeline.clips[0], id: `large-${i}`, text: "x".repeat(2000) })) };
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: oversized })).rejects.toThrow("Timeline is too large");
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(0);
  const large: Timeline = { ...textTimeline, clips: Array.from({ length: 60 }, (_, i) => ({ ...textTimeline.clips[0], id: `large-${i}`, text: "x".repeat(2000) })) };
  const history = boundedHistory(Array.from({ length: 10 }, () => large)); expect(serializedBytes(history)).toBeLessThanOrEqual(500000); expect(history.length).toBeGreaterThan(0); expect(history.length).toBeLessThan(10);
});

test("long subject tracking stays usable on repeated trims without oversized documents", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const storageId = await uploadedFile(t, "owner", projectId);
  const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "long-video.mp4", kind: "video", duration: 300 });
  const focus = Array.from({ length: 1500 }, (_, index) => ({ time: index / 5, x: 0.5 + Math.sin(index) / 10, y: 0.5 }));
  await owner.mutation(api.assets.saveFocus, { projectId, assetId, focus });
  const clips = Array.from({ length: 20 }, (_, index) => ({ id: `tracked-${index}`, kind: "video" as const, assetId, start: index, duration: 1, sourceStart: 10, focus }));
  await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, clips } })).rejects.toThrow("Timeline is too large");
  const trimmed = clips.map(clip => ({ ...clip, focus: focusForClip(focus, clip) }));
  expect(trimmed[0].focus).toHaveLength(8);
  expect(trimmed[0].focus[0].time).toBeLessThan(10);
  expect(trimmed[0].focus.at(-1)!.time).toBeGreaterThan(11);
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, clips: trimmed } });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.clips).toHaveLength(20);
});

test("analysis is owned and background workers save fresh results without a browser relay", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner")); const stranger = t.withIdentity(identity("stranger"));
  const storageId = await uploadedFile(t, "owner", projectId);
  const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "workflow-run" }));
  const run = { projectId, ownerId: "owner", runId: "workflow-run" };
  const requestId = await t.mutation(internal.assistant.requestAnalysis, { ...run, assetId, mode: "transcribe" });
  const request = await t.query(internal.assistant.analysisRequest, { ...run, requestId });
  expect(request.taskId).toBeDefined();
  await expect(stranger.query(api.mediaTasks.get, { taskId: request.taskId! })).rejects.toThrow("not found");
  await t.mutation(internal.mediaTasks.prepareAttempt, { taskId: request.taskId!, attempt: 1 });
  const task = await t.mutation(api.mediaTasks.claim, { workerSecret: "test-worker-secret" });
  expect(task?.taskId).toBe(request.taskId);
  await expect(t.mutation(api.mediaTasks.complete, { taskId: task!.taskId, leaseToken: "wrong", result: {} })).rejects.toThrow("lease");
  await expect(t.mutation(api.mediaTasks.complete, { taskId: task!.taskId, leaseToken: task!.leaseToken, result: {} })).rejects.toThrow("missing");
  const transcript = { segments: [{ start: 0, end: 1, text: "Real speech" }], words: [] };
  await t.mutation(api.mediaTasks.complete, { taskId: task!.taskId, leaseToken: task!.leaseToken, result: { analysis: { transcript } } });
  expect((await t.query(internal.assistant.analysisRequest, { ...run, requestId })).status).toBe("completed");
  expect((await owner.query(api.assets.get, { projectId, assetId })).analysis?.transcript).toEqual(transcript);
});

test("worker analysis requires an active exact run and scoped media, then rejects stale results", async () => {
  const t = makeTest(); const projectId = await project(t); const otherProjectId = await project(t, "stranger"); const owner = t.withIdentity(identity("owner"));
  const storageId = await uploadedFile(t, "owner", projectId);
  const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
  const bridge = { projectId, assetId, aiRunId: "worker-run", workerSecret: "test-worker-secret" };
  await expect(t.query(api.assets.getForAssistant, bridge)).rejects.toThrow("AI run is no longer active");
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "worker-run" }));
  await t.run(ctx => ctx.db.patch(otherProjectId, { aiRunning: true, aiRunId: "other-run" }));
  await expect(t.query(api.assets.getForAssistant, { ...bridge, workerSecret: "wrong" })).rejects.toThrow("worker authentication");
  await expect(t.query(api.assets.getForAssistant, { ...bridge, projectId: otherProjectId, aiRunId: "other-run" })).rejects.toThrow("Media not found");
  expect(await t.query(api.assets.getForAssistant, bridge)).toMatchObject({ ownerId: "owner", url: expect.any(String) });
  await t.mutation(api.assets.saveAnalysis, { ...bridge, beats: { beats: [0, 1, 2], bpm: 120, confidence: 0.9 } });
  const run = { projectId, ownerId: "owner", runId: "worker-run" };
  await t.mutation(internal.assistant.requestAnalysis, { ...run, assetId, mode: "beats" });
  await t.run(ctx => ctx.db.patch(projectId, { aiRunId: "new-run" }));
  await expect(t.mutation(api.assets.saveAnalysis, { ...bridge, beats: { beats: [0, 1], bpm: 120, confidence: 0.9 } })).rejects.toThrow("AI run is no longer active");
});

test("chat selection and playhead cannot reference another timeline or invalid time", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: "Style this", selectedClipId: "foreign-clip" })).rejects.toThrow("Selected clip does not belong");
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: "Cut here", playhead: -1 })).rejects.toThrow("Playhead must be a finite");
  expect((await owner.query(api.projects.get, { projectId })).threadId).toBeUndefined();
});

test("visual layers, transforms, and crop bounds persist with undo and reject malformed edits", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const storageId = await uploadedFile(t, "owner", projectId);
  const assetId = await owner.mutation(api.assets.create, { projectId, storageId, fileName: "clip.mp4", kind: "video", duration: 5 });
  const clip = { id: "layered-video", kind: "video" as const, assetId, track: 2, fit: "contain" as const, start: 0, duration: 2, sourceStart: 0, transform: { x: 0.7, y: 0.3, scale: 0.4, rotation: 15, opacity: 0.8 }, crop: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 } };
  const timeline: Timeline = { ...textTimeline, clips: [clip], tracks: { visual: 2, overlay: 2, audio: 1 } };
  for (const invalid of [
    { ...timeline, clips: [{ ...clip, track: 1.5 }] },
    { ...timeline, tracks: { visual: 1, overlay: 2, audio: 1 } },
    { ...timeline, tracks: { visual: 13, overlay: 2, audio: 1 } },
    { ...timeline, clips: [{ ...clip, transform: { ...clip.transform, scale: 6 } }] },
    { ...timeline, clips: [{ ...clip, crop: { ...clip.crop, left: 0.6, right: 0.4 } }] },
    { ...timeline, clips: [{ ...clip, volume: 2.5 }] },
    { ...textTimeline, clips: [{ ...textTimeline.clips[0], transform: clip.transform }] },
    { ...textTimeline, clips: [{ ...textTimeline.clips[0], fit: "contain" as const }] },
    { ...textTimeline, clips: [{ ...textTimeline.clips[0], color: "url(https://example.com)" }] },
  ]) await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: invalid })).rejects.toThrow();
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(0);
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline });
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...timeline, clips: [{ ...clip, transform: { ...clip.transform, x: 0.5 } }] } });
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(normalizeTimeline(timeline));
});

test("new aspect presets save and undo while render snapshots retain their chosen canvas", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, aspectRatio: "portrait-feed" } });
  const jobId = await owner.mutation(api.renders.start, { projectId, resolution: 1080, fps: 30, quality: "standard" });
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...textTimeline, aspectRatio: "classic" } });
  expect((await owner.query(api.projects.get, { projectId })).aspectRatio).toBe("classic");
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).aspectRatio).toBe("portrait-feed");
  expect((await owner.mutation(api.renders.claim, { jobId, workerSecret: "test-worker-secret" })).timeline.aspectRatio).toBe("portrait-feed");
});

test("new upload tickets clean expired unclaimed media without touching attached assets", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const abandoned = await uploadedFile(t, "owner", projectId);
  const retained = await uploadedFile(t, "owner", projectId);
  const assetId = await owner.mutation(api.assets.create, { projectId, storageId: retained, fileName: "retained.mp4", kind: "video" });
  await t.run(async ctx => { const ticket = await ctx.db.query("uploadTickets").withIndex("by_storageId", q => q.eq("storageId", abandoned)).unique(); await ctx.db.patch(ticket!._id, { expiresAt: Date.now() - 1 }); });
  await owner.mutation(api.assets.generateUploadUrl, { projectId });
  expect(await t.run(ctx => ctx.db.system.get(abandoned))).toBeNull();
  expect((await owner.query(api.assets.get, { projectId, assetId })).storageId).toBe(retained);
  expect(await t.run(ctx => ctx.db.system.get(retained))).not.toBeNull();
});

test("empty groups can have zero tracks, persist through undo, and cannot contain clips", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const empty: Timeline = { ...textTimeline, clips: [], tracks: { visual: 0, overlay: 0, audio: 0 } };
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: empty });
  expect((await owner.query(api.projects.get, { projectId })).timeline?.tracks).toEqual({ visual: 0, overlay: 0, audio: 0 });
  for (const invalid of [
    { ...empty, tracks: { visual: -1, overlay: 0, audio: 0 } },
    { ...empty, tracks: { visual: 0, overlay: 0.5, audio: 0 } },
    { ...empty, tracks: { visual: 0, overlay: 0, audio: 13 } },
    { ...empty, clips: [{ ...textTimeline.clips[0], track: 1 }] },
    { ...empty, tracks: { visual: 0, overlay: 1, audio: 0 }, clips: [{ ...textTimeline.clips[0], track: 0 }] },
  ]) await expect(owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: invalid })).rejects.toThrow();
  expect((await owner.query(api.projects.get, { projectId })).revision).toBe(1);
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: { ...empty, tracks: { visual: 0, overlay: 1, audio: 0 }, clips: [{ ...textTimeline.clips[0], track: 1 }] } });
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(empty);
});

test("chat multi-selection validates ownership, duplicates, and limits before scheduling", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  const clips = Array.from({ length: 200 }, (_, index) => ({ ...textTimeline.clips[0], id: `selected-${index}` }));
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, clips } });
  for (const [selectedClipIds, reason] of [
    [["selected-0", "foreign"], "must belong to this project"],
    [["selected-0", "selected-0"], "must be unique"],
    [Array.from({ length: 201 }, (_, index) => `selected-${index}`), "at most 200"],
  ] as const) await expect(owner.mutation(api.assistant.send, { projectId, prompt: "Style the selection", selectedClipIds: [...selectedClipIds] })).rejects.toThrow(reason);
  await expect(t.withIdentity(identity("stranger")).mutation(api.assistant.send, { projectId, prompt: "Style the selection", selectedClipIds: ["selected-0"] })).rejects.toThrow("Project not found");
  await expect(owner.mutation(api.assistant.send, { projectId, prompt: "Style the selection", selectedClipIds: clips.map(clip => clip.id) })).rejects.toThrow("ANTHROPIC_API_KEY");
  expect((await owner.query(api.projects.get, { projectId })).threadId).toBeUndefined();
});

test("chat schedules validated multi-selection without changing the visible user prompt", async () => {
  const t = makeTest(); agentTest.register(t); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: { ...textTimeline, clips: [...textTimeline.clips, { ...textTimeline.clips[0], id: "caption-2", start: 3 }] } });
  vi.stubEnv("ANTHROPIC_API_KEY", "unit-test-not-a-provider-key");
  const fetch = vi.spyOn(globalThis, "fetch");
  await owner.mutation(api.assistant.send, { projectId, prompt: "Style these captions", selectedClipId: "caption-1", selectedClipIds: ["caption-1", "caption-2"], playhead: 2 });
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(10));
  const run = scheduled.find(item => item.args[0]?.selectedClipIds);
  expect(run?.args[0]).toMatchObject({ selectedClipId: "caption-1", selectedClipIds: ["caption-1", "caption-2"], playhead: 2 });
  await t.run(ctx => ctx.scheduler.cancel(run!._id));
  const stored = await owner.query(api.projects.get, { projectId });
  const messages = await owner.query(api.assistant.messages, { projectId, threadId: stored.threadId!, paginationOpts: { cursor: null, numItems: 20 } });
  expect(messages.page[0]).toMatchObject({ text: "Style these captions" });
  expect(fetch).not.toHaveBeenCalled();
});

test("timeline inspection distinguishes visual gaps and same-layer overlaps from intentional stacking", () => {
  const timeline: Timeline = { ...textTimeline, clips: [
    { id: "a", kind: "video", assetId: "video-a", track: 1, start: 2, duration: 2, sourceStart: 0 },
    { id: "b", kind: "video", assetId: "video-b", track: 1, start: 3, duration: 2, sourceStart: 0 },
    { id: "stacked", kind: "video", assetId: "video-b", track: 2, start: 3, duration: 2, sourceStart: 0 },
    { id: "missing", kind: "image", assetId: "missing-image", track: 1, start: 7, duration: 1, sourceStart: 0 },
    { ...textTimeline.clips[0], duration: 9 },
  ] };
  const summary = summarizeTimeline(timeline, [{ _id: "video-a", kind: "video" }, { _id: "video-b", kind: "video" }]);
  expect(summary.duration).toBe(9);
  expect(summary.gaps).toEqual([{ start: 0, end: 2 }, { start: 5, end: 7 }, { start: 8, end: 9 }]);
  expect(summary.overlaps).toEqual([{ group: "visual", track: 1, clipIds: ["a", "b"], start: 3, end: 4 }]);
  expect(summary.missingAssetRefs).toEqual([{ clipId: "missing", assetId: "missing-image" }]);
  const crowded = summarizeTimeline({ ...textTimeline, clips: Array.from({ length: 30 }, (_, index) => ({ ...textTimeline.clips[0], id: `overlap-${index}` })) }, []);
  expect(crowded.overlapCount).toBe(435); expect(crowded.overlaps).toHaveLength(100); expect(crowded.overlapsTruncated).toBe(true);
});

test("inspection backing query reads the latest manual revision and does not mutate the project", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "inspect-run" }));
  const run = { projectId, ownerId: "owner", runId: "inspect-run" };
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 0, timeline: textTimeline });
  expect((await t.query(internal.assistant.getRun, run)).project.revision).toBe(1);
  const next = { ...textTimeline, clips: [{ ...textTimeline.clips[0], duration: 6 }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: next });
  const before = await owner.query(api.projects.get, { projectId });
  const inspected = await t.query(internal.assistant.getRun, run);
  expect(inspected.project.revision).toBe(2); expect(inspected.project.timeline).toEqual(next);
  expect(await owner.query(api.projects.get, { projectId })).toEqual(before);
  await expect(t.query(internal.assistant.getRun, { ...run, ownerId: "stranger" })).rejects.toThrow("Project not found");
});

test("AI edits after inspecting a manual revision start a new undo group preserving manual work", async () => {
  const t = makeTest(); const projectId = await project(t); const owner = t.withIdentity(identity("owner"));
  await t.run(ctx => ctx.db.patch(projectId, { aiRunning: true, aiRunId: "inspect-undo-run", aiUndoRecorded: false }));
  const run = { projectId, ownerId: "owner", runId: "inspect-undo-run" };
  await t.mutation(internal.assistant.apply, { ...run, expectedRevision: 0, timeline: textTimeline });
  const manual: Timeline = { ...textTimeline, aspectRatio: "square", clips: [{ ...textTimeline.clips[0], text: "Human edit" }] };
  await owner.mutation(api.projects.saveTimeline, { projectId, expectedRevision: 1, timeline: manual });
  const fresh = await t.query(internal.assistant.getRun, run);
  const updated: Timeline = { ...manual, clips: [{ ...manual.clips[0], fontSize: 64 }] };
  await t.mutation(internal.assistant.apply, { ...run, expectedRevision: fresh.project.revision!, timeline: updated });
  await t.mutation(internal.assistant.apply, { ...run, expectedRevision: 3, timeline: { ...updated, clips: [{ ...updated.clips[0], fontSize: 72 }] } });
  expect((await owner.query(api.projects.get, { projectId })).history).toHaveLength(3);
  await owner.mutation(api.projects.undo, { projectId });
  expect((await owner.query(api.projects.get, { projectId })).timeline).toEqual(manual);
});

 test("above-unity audio gain persists, snapshots for export, and undoes to the original level", async () => {
  const t=makeTest(), projectId=await project(t), owner=t.withIdentity(identity("owner"));
  const storageId=await uploadedFile(t,"owner",projectId,"audio/mp4");
  const assetId=await owner.mutation(api.assets.create,{projectId,storageId,fileName:"tone.m4a",kind:"audio",duration:5});
  const timeline:Timeline={fps:30,aspectRatio:"vertical",tracks:{visual:0,overlay:0,audio:1},clips:[{id:"sound",kind:"audio",assetId,track:1,start:0,duration:2,sourceStart:0,volume:1}]};
  await owner.mutation(api.projects.saveTimeline,{projectId,expectedRevision:0,timeline});
  await owner.mutation(api.projects.saveTimeline,{projectId,expectedRevision:1,timeline:{...timeline,clips:[{...timeline.clips[0],volume:2}]}});
  expect((await owner.query(api.projects.get,{projectId})).timeline?.clips[0].volume).toBe(2);
  const jobId=await owner.mutation(api.renders.start,{projectId,resolution:720,fps:30,quality:"draft"});
  expect((await owner.mutation(api.renders.claim,{jobId,workerSecret:"test-worker-secret"})).timeline.clips[0].volume).toBe(2);
  await owner.mutation(api.projects.undo,{projectId});
  expect((await owner.query(api.projects.get,{projectId})).timeline?.clips[0].volume).toBe(1);
});
