import { AsyncLocalStorage } from 'node:async_hooks';
import type { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import type { EditorCostRecord } from '../ai/cost-history';
import { AnalysisError } from '../media-analysis/errors';

type GeminiContext = { fetch: (body: string, signal: AbortSignal) => Promise<Response>; record: (record: EditorCostRecord) => Promise<void> };
const context = new AsyncLocalStorage<GeminiContext>();

/** Task-local scope keeps simultaneous worker slots' credentials and cost records separate. */
export function withMediaGemini<T>(task: MediaWorkItem, client: ConvexHttpClient, convexUrl: string, work: () => Promise<T>) {
  const credentials = { taskId: task.taskId, leaseToken: task.leaseToken };
  const origin = convexUrl.replace(/\.convex\.cloud\/?$/, '.convex.site');
  return context.run({
    fetch: (body, signal) => fetch(`${origin}/media/gemini`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-media-task-id': task.taskId, 'x-media-lease-token': task.leaseToken }, body }),
    record: async record => { await client.mutation(api.geminiGateway.recordCost, { ...credentials, record }); },
  }, work);
}

export function mediaGeminiContext() {
  const current = context.getStore();
  if (!current) throw new AnalysisError('Gemini Gateway access requires an active media task on this Convex deployment.', 503, false);
  return current;
}

export async function recordMediaGeminiCost(record: EditorCostRecord) {
  try { await context.getStore()?.record(record); }
  catch { console.warn('[ai-cost] Gemini usage could not be recorded.', { route: record.route, model: record.model }); }
}
