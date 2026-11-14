/** Diagnostics have a deliberately small privacy budget, including free-form agent reports. */
export function incidentText(value: string, limit = 2000, prose = false): string {
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
    // Prose (a limitation's sentences) keeps its apostrophes: can't and doesn't are not a quoted value.
    .replace(prose ? /(["`])[^\n]*?\1|(?<![\p{L}\p{N}])'[^\n']*'(?![\p{L}\p{N}])/gu : /(["'`])[^\n]*?\1/g, '[quoted value]')
    .replace(/“[^”\n]*”|‘[^’\n]*’/g, '[quoted value]')
    .slice(0, limit);
}

/** Reports the editing agent files itself. Both become public GitHub issues and never reach the automated fixer on their own. */
export const AGENT_FILED_KINDS = ['agent-report', 'agent-limitation'] as const;
export type AgentFiledKind = typeof AGENT_FILED_KINDS[number];
export const isAgentFiled = (kind: string): kind is AgentFiledKind => (AGENT_FILED_KINDS as readonly string[]).includes(kind);

/** reportLimitation: the tools worked as designed but could not do what the user asked. */
export const LIMITATION_CATEGORIES = ['missing-tool', 'missing-option', 'hard-limit', 'unsupported-media', 'quality-ceiling', 'policy-or-check', 'other'] as const;
export const LIMITATION_IMPACTS = ['blocked', 'degraded', 'slower'] as const;
const LIMITATION_FIELDS = ['request', 'limitation', 'category', 'workaround', 'impact', 'wanted', 'lane', 'model'] as const;
/** Wording-insensitive text for a limitation's fingerprint: scrubbed, lower case, letters and digits only. Numbers stay: 4K and 8K are different limits. */
export const limitationNormalized = (value: string) => incidentText(value, 2000, true).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** One limitation is one incident row: the same category, tool and normalized limitation text, whoever met it. */
export const limitationIdentity = (category: string, tool: string | undefined, limitation: string) => ['agent-limitation', category, limitationNormalized(tool ?? ''), limitationNormalized(limitation)];

export function incidentContext(value: unknown, limitation = false): string {
  // Only known diagnostic fields survive; never persist arbitrary inputs, headers, prompts or media.
  // A limitation's own fields are kept for that kind only, so no other report can carry a request or free text.
  const fields = new Set(['location', 'toolName', 'taskKind', 'taskId', 'jobId', 'turnId', 'threadId', 'inputSummary', 'happened', 'expected', 'inputShape', 'outputShape', 'condition', 'attempt', 'savedEdits', 'label', 'event', ...(limitation ? LIMITATION_FIELDS : [])]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).slice(0, 16).map(([key, item]) => [key, typeof item === 'string' ? incidentText(item, 600, limitation) : typeof item === 'number' || typeof item === 'boolean' ? item : '[omitted]'])));
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

/** A tool call in an assistant turn (in-app or MCP) that returned an error or a refusal. The turn usually carries on, so
 * nothing else records it. tool-input-invalid is the AI SDK refusing the model's arguments against the tool's schema:
 * a schema or prompt bug. Both group by tool, error class and normalized message, and become public issues only once
 * they repeat (scripts/incident-listener/issues.ts). Never sent to the automated fixer. */
export const TOOL_ERROR_KINDS = ['tool-error', 'tool-input-invalid'] as const;
export type ToolErrorKind = typeof TOOL_ERROR_KINDS[number];
export const isToolErrorKind = (kind: string): kind is ToolErrorKind => (TOOL_ERROR_KINDS as readonly string[]).includes(kind);
/** Kinds the issue publisher files: agent reports at once, tool errors once they repeat. */
export const ISSUE_FILED_KINDS = [...AGENT_FILED_KINDS, ...TOOL_ERROR_KINDS] as const;
export type IssueFiledKind = typeof ISSUE_FILED_KINDS[number];
export const isIssueFiled = (kind: string): kind is IssueFiledKind => (ISSUE_FILED_KINDS as readonly string[]).includes(kind);
/** What failed, from a fixed list so it can be shown publicly: how the arguments were refused, a returned refusal, a
 * failed finish check, a thrown error, or a thrown run failure's own code (lib/ai/run-failure). */
export const TOOL_ERROR_CLASSES = ['input-invalid', 'invalid-json', 'unknown-tool', 'refusal', 'check-failed', 'thrown', 'conflict', 'locked', 'refused', 'limit', 'unavailable', 'invalid', 'internal'] as const;
export type ToolErrorClass = typeof TOOL_ERROR_CLASSES[number];
/** recovered: the turn went on past the error (as of the latest report). turn-failed: the turn it happened in failed. */
export const TOOL_ERROR_IMPACTS = ['recovered', 'turn-failed'] as const;
export type ToolErrorImpact = typeof TOOL_ERROR_IMPACTS[number];
/** A schema issue without its value: where in the arguments and which check. */
export type ToolInputIssue = { path: string; code: string };
export type ToolErrorReport = { toolName: string; kind: ToolErrorKind; errorClass: ToolErrorClass; message: string; issues?: ToolInputIssue[] };
/** Repeats needed before a tool error becomes a public issue: this many occurrences, or this many users, in the window. */
export const TOOL_ERROR_THRESHOLD = { windowMs: 7 * 24 * 60 * 60_000, occurrences: 3, users: 2 } as const;

/** A tool error's message reduced to its shape: scrubbed, quoted text removed, and every token holding a digit (ids,
 * times, counts, 3.2s, clip_4f) replaced, so the same refusal about different clips is one row. */
export function toolErrorNormalized(message: string): string {
  return incidentText(message, 2000).toLowerCase()
    .replace(/\[request id:[^\]]*\]/g, '')
    .replace(/^(?:\s*(?:uncaught\s+)?(?:convexerror|error|server error)\s*:?)+/g, '')
    .replace(/[\w.:/-]*\d[\w.:/-]*/g, '#')
    .replace(/\[(?:quoted value|opaque value|media file|email|url|redacted|credential redacted|payload omitted)\]/g, '…')
    .replace(/(?:[#…][\s,]*){2,}/g, '# ')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}
/** Path segments are schema property names; array indexes and anything that is not a plain name are masked. */
const issuePath = (path: readonly unknown[]) => path.slice(0, 8).map(part => typeof part === 'number' || /^\d+$/.test(String(part)) ? '#' : /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(String(part)) ? String(part) : '?').join('.') || '(root)';
/** The zod issues behind an AI SDK input-validation failure, without their values. Follows the error's cause chain. */
export function toolInputIssues(error: unknown): ToolInputIssue[] | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues.slice(0, 8).map(issue => {
      const item = issue && typeof issue === 'object' ? issue as { path?: unknown; code?: unknown } : {};
      return { path: issuePath(Array.isArray(item.path) ? item.path : []), code: typeof item.code === 'string' && /^[a-z_]{1,40}$/.test(item.code) ? item.code : 'unknown' };
    });
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
const issueSignature = (issues: readonly ToolInputIssue[]) => [...new Set(issues.map(issue => `${issue.path}:${issue.code}`))].sort().join(' ') || 'no issues';
/** One tool error is one incident row: the same kind, tool, class and normalized message (or schema issues), whoever met it. */
export const toolErrorIdentity = (report: ToolErrorReport) => [report.kind, report.toolName, report.errorClass, report.kind === 'tool-input-invalid' && report.issues ? issueSignature(report.issues) : toolErrorNormalized(report.message)];
/** The row's private message: structure only, never the raw error text. */
export const toolErrorMessage = (report: ToolErrorReport) => `${report.toolName}: ${report.errorClass}: ${report.kind === 'tool-input-invalid' && report.issues ? issueSignature(report.issues) : toolErrorNormalized(report.message)}`;
export const toolErrorIssueText = (issues: readonly ToolInputIssue[] | undefined) => issues ? issueSignature(issues) : undefined;
