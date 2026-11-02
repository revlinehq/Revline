/** Diagnostics have a deliberately small privacy budget, including free-form agent reports. */
export function incidentText(value: string, limit = 2000): string {
  return value
    .replace(/(?:^|\n|\s)(?:Object|Value|Arguments|Args|Validator):\s*[\s\S]*/i, ' [payload omitted]')
    .replace(/data:[^;\s]+;base64,[\w+/=]+/gi, '[media omitted]')
    .replace(/\b(?:dev|prod|preview):[\w-]+\|[^\s"']+/gi, '[deployment credential]')
    .replace(/\b[\da-f]{32,}\b/gi, '[opaque value]')
    .replace(/\b[A-Za-z0-9+/_=-]{80,}\b/g, '[opaque value]')
    .replace(/[^\s/\\]+\.(?:mp4|mov|webm|mkv|mp3|wav|m4a|png|jpe?g|gif|pdf|docx)\b/gi, '[media file]')
    .replace(/(?:Bearer\s+)[\w.+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|pk|rk|whsec|gh[pousr]|github_pat|xox[baprs])[-_][\w.-]+/gi, '[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/\b(?:secret|token|password|authorization|cookie|api[_-]?key|credential|signature)\b["']?\s*[:=]\s*["']?[^\s,"';}]+/gi, '[credential redacted]')
    .replace(/https?:\/\/[^\s)"'<>]+/g, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[url]'; } })
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(?:\/Users\/|\/home\/)[^/\s]+/g, '/[home]')
    .replace(/(["'`])[^\n]*?\1/g, '[quoted value]')
    .replace(/“[^”\n]*”|‘[^’\n]*’/g, '[quoted value]')
    .slice(0, limit);
}

export function incidentContext(value: unknown): string {
  // Only known diagnostic fields survive; never persist arbitrary inputs, headers, prompts or media.
  const fields = new Set(['location', 'toolName', 'taskKind', 'taskId', 'jobId', 'turnId', 'threadId', 'inputSummary', 'happened', 'expected', 'inputShape', 'outputShape', 'condition', 'attempt', 'savedEdits', 'label', 'event']);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).slice(0, 16).map(([key, item]) => [key, typeof item === 'string' ? incidentText(item, 600) : typeof item === 'number' || typeof item === 'boolean' ? item : '[omitted]'])));
}

export function incidentNormalized(value: string): string {
  return incidentText(value).toLowerCase()
    .replace(/\[request id:[^\]]*\]/g, '')
    .replace(/\b[\da-f]{12,}\b|\b[\w-]{24,}\b|\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ').trim();
}

/** Keep diagnostic reports, but do not spend a fixer session on an expected refusal. */
export function incidentNonDefectReason(message: string, kind: string, contexts: readonly string[] = []): string | null {
  const happened = contexts.flatMap(context => {
    try { const value: unknown = JSON.parse(context); return value && typeof value === 'object' && 'happened' in value && typeof value.happened === 'string' ? [value.happened] : []; }
    catch { return []; }
  });
  const evidence = [message, ...happened].join('\n');
  if (/\b402\b|\bpayment required\b|\binsufficient[ _-](?:credits?|balance|quota)\b|\bcredit balance (?:is )?too low\b|\b(?:billing hard limit|credits? exhausted|out of credits|exceeded (?:your )?current quota)\b/i.test(evidence)) return 'Provider billing or credits require attention';
  if (/\badd (?:a|at least one) clip before exporting\b|\b(?:intended|expected) validation (?:refusal|failure|error)\b/i.test(evidence)) return 'Intended validation refusal';
  if (kind === 'agent-report' && /\bno (?:reproducible |actual |confirmed )?(?:product )?(?:defect|bug)(?:s)?\b|\bnot a (?:product )?(?:defect|bug)\b|\bworking as (?:intended|expected)\b/i.test(evidence)) return 'Agent reported no product defect';
  return null;
}
