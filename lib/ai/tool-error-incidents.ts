import { plainFailureText } from './failure-text';
import { runFailureOf } from './run-failure';
import { toolErrorIdentity, toolInputIssues, type ToolErrorClass, type ToolErrorReport } from '../incidents';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const errorName = (error: unknown) => typeof record(error).name === 'string' ? String(record(error).name) : '';
const text = (value: unknown) => (typeof value === 'string' ? value : plainFailureText(value) || (value instanceof Error ? value.message : '')).slice(0, 2000);

/** How a thrown tool error is classed: a coded run failure's code, or a plain throw. */
export function thrownClass(error: unknown): ToolErrorClass {
  return runFailureOf(error)?.code ?? 'thrown';
}

/** A model-argument refusal by the AI SDK (the invalid tool-call part carries the original error object). */
export function invalidInputReport(toolName: string, error: unknown): ToolErrorReport {
  const name = errorName(error);
  if (name === 'AI_NoSuchToolError') return { toolName, kind: 'tool-error', errorClass: 'unknown-tool', message: 'unknown tool' };
  const issues = toolInputIssues(error);
  if (issues?.length) return { toolName, kind: 'tool-input-invalid', errorClass: 'input-invalid', message: '', issues };
  // A schema error with no issue list is malformed JSON; any other error here was thrown by our repair hook.
  if (name === 'AI_InvalidToolInputError' || name === 'AI_JSONParseError' || name === 'AI_TypeValidationError') return { toolName, kind: 'tool-input-invalid', errorClass: 'invalid-json', message: '', issues: [] };
  return { toolName, kind: 'tool-error', errorClass: thrownClass(error), message: text(error) };
}

/** A tool's own refusal or thrown error, as recorded in a finished step. */
export function failedResultReport(toolName: string, output: unknown): ToolErrorReport | undefined {
  const wrapped = record(output);
  if (wrapped.type === 'error-text' || wrapped.type === 'error-json') return { toolName, kind: 'tool-error', errorClass: thrownClass(wrapped.value), message: text(wrapped.value) };
  const value = wrapped.type === 'json' ? record(wrapped.value) : wrapped;
  // A refusal that spends no attempt asks for another step first, and an unavailable review service is not the tool's error.
  if (value.success !== false || value.attemptRecorded === false || value.reviewUnavailable === true) return undefined;
  const failures = Array.isArray(value.failures) ? value.failures.filter(item => typeof item === 'string') : [];
  const message = text(value.error) || failures[0] || (typeof value.reason === 'string' ? value.reason : '') || 'unsuccessful result';
  // A coded result ({success:false, errorCode:'conflict'}) keeps its run-failure code.
  return { toolName, kind: 'tool-error', errorClass: runFailureOf(value)?.code ?? (toolName === 'finish' ? 'check-failed' : 'refusal'), message };
}

/** Every failed tool call in a finished step: invalid arguments, thrown errors and returned refusals. */
export function stepToolErrors(content: readonly unknown[]): ToolErrorReport[] {
  const reports: ToolErrorReport[] = [], invalid = new Set<string>();
  for (const value of content) {
    const part = record(value), toolName = typeof part.toolName === 'string' ? part.toolName.slice(0, 64) : '';
    if (!toolName || part.preliminary === true) continue;
    if (part.type === 'tool-call' && part.invalid === true) { invalid.add(String(part.toolCallId ?? '')); reports.push(invalidInputReport(toolName, part.error)); }
    // The SDK follows an invalid call with a tool-error holding only its message; the call above already counted it.
    else if (part.type === 'tool-error' && !invalid.has(String(part.toolCallId ?? ''))) reports.push({ toolName, kind: 'tool-error', errorClass: thrownClass(part.error), message: text(part.error) });
    else if (part.type === 'tool-result') { const report = failedResultReport(toolName, part.output); if (report) reports.push(report); }
  }
  return reports;
}

/** Collects one turn's tool errors once each, across steps and repair passes. */
export class TurnToolErrors {
  private readonly seen = new Map<string, ToolErrorReport>();
  private readonly delivered = new Set<string>();
  private key(report: ToolErrorReport) { return JSON.stringify(toolErrorIdentity(report)); }
  /** The reports not seen before in this turn. */
  add(reports: readonly ToolErrorReport[]): ToolErrorReport[] {
    const fresh: ToolErrorReport[] = [];
    for (const report of reports) {
      const key = this.key(report);
      if (this.seen.has(key) || this.seen.size >= 60) continue;
      this.seen.set(key, report);
      fresh.push(report);
    }
    return fresh;
  }
  /** A report that reached the server; one that did not is tried again with the next step. */
  settled(reports: readonly ToolErrorReport[], ok: boolean) {
    for (const report of reports) { const key = this.key(report); if (ok) this.delivered.add(key); else this.seen.delete(key); }
  }
  /** Every report of the turn, each marked when the server has already counted it. */
  all(): (ToolErrorReport & { counted?: true })[] { return [...this.seen].map(([key, report]) => this.delivered.has(key) ? { ...report, counted: true as const } : report); }
}
