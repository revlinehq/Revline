import type { Doc } from '../_generated/dataModel';

/** Durable facts about an unfinished request; the next user request still takes precedence. */
export function assistantRecovery(project: Doc<'projects'>, status: 'failed' | 'stopped', reason: string, savedEdits?: number): NonNullable<Doc<'projects'>['aiRecovery']> {
  const requests = [...new Set([...(project.aiRecovery?.requests ?? []), ...(project.aiRequest?.prompt ? [project.aiRequest.prompt] : [])])];
  return { requests: requests.length > 4 ? [requests[0], ...requests.slice(-3)] : requests,
    runId: project.aiRunId ?? project.aiRecovery?.runId ?? 'legacy', revision: project.revision ?? 0,
    ...(savedEdits !== undefined && Number.isSafeInteger(savedEdits) && savedEdits >= 0 ? { savedEdits } : {}),
    status, reason: reason.slice(0, 1000), updatedAt: Date.now() };
}
