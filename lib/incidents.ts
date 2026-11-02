/** Diagnostics have a deliberately small privacy budget, including free-form agent reports. */
export function incidentText(value: string, limit = 2000): string {
  return value
    .replace(/(?:^|\n|\s)(?:Object|Value|Arguments|Args|Validator):\s*[\s\S]*/i, ' [payload omitted]')
    .replace(/data:[^;\s]+;base64,[\w+/=]+/gi, '[media omitted]')
    .replace(/(?:Bearer\s+)[\w.+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xox[baprs])[-_][\w.-]+/gi, '[redacted]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/\b(?:secret|token|password|authorization|cookie|api[_-]?key|credential|signature)\b["']?\s*[:=]\s*["']?[^\s,"';}]+/gi, '[credential redacted]')
    .replace(/https?:\/\/[^\s)"'<>]+/g, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[url]'; } })
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(?:\/Users\/|\/home\/)[^/\s]+/g, '/[home]')
    .replace(/(["'`])[^\n]*?\1/g, '[quoted value]')
    .slice(0, limit);
}

export function incidentContext(value: unknown): string {
  // Only known diagnostic fields survive; never persist arbitrary inputs, headers, prompts or media.
  const fields = new Set(['location', 'toolName', 'taskKind', 'taskId', 'jobId', 'turnId', 'threadId', 'inputSummary', 'happened', 'expected', 'inputShape', 'outputShape', 'condition', 'attempt', 'savedEdits', 'label', 'event']);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).slice(0, 16).map(([key, item]) => [key, typeof item === 'string' ? incidentText(item, 600) : typeof item === 'number' || typeof item === 'boolean' ? item : '[omitted]']))).slice(0, 8000);
}

export function incidentNormalized(value: string): string {
  return incidentText(value).toLowerCase()
    .replace(/\[request id:[^\]]*\]/g, '')
    .replace(/\b[\da-f]{12,}\b|\b[\w-]{24,}\b|\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ').trim();
}
