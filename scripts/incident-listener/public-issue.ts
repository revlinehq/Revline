import { z } from 'zod';
import { EDITOR_TOOL_DEFINITIONS } from '../../lib/ai/tool-definitions';
import { PROJECT_BASE_TOOLS } from '../../lib/ai/lanes/base-tools';
import { LIMITATION_CATEGORIES, LIMITATION_IMPACTS, TOOL_ERROR_CLASSES, TOOL_ERROR_IMPACTS, TOOL_ERROR_THRESHOLD, isToolErrorKind, type AgentFiledKind, type IssueFiledKind } from '../../lib/incidents';

// The repository is public. An issue carries only structured facts the server
// controls: an allow-listed tool name, enum values, counts, times and fingerprint.
// Report text, requests, workarounds, messages and project identifiers stay private in Convex.
export const FORMAT = '<!-- revline-issue-format:2 -->';
export const ISSUE_KINDS: Record<IssueFiledKind, { marker: string; labels: string[] }> = {
  'agent-report': { marker: '<!-- revline-agent-report:', labels: [] },
  'agent-limitation': { marker: '<!-- revline-agent-limitation:', labels: ['limitation'] },
  'tool-error': { marker: '<!-- revline-tool-error:', labels: ['tool-error'] },
  'tool-input-invalid': { marker: '<!-- revline-tool-input-invalid:', labels: ['tool-error'] },
};
export const LIMITATION_LABEL = { name: 'limitation', color: 'd4c5f9', description: 'A product limit an editing agent met while doing what a user asked' };
export const TOOL_ERROR_LABEL = { name: 'tool-error', color: 'f9d0c4', description: 'A tool call in assistant turns that keeps returning the same error' };
export const ISSUE_LABELS = [LIMITATION_LABEL, TOOL_ERROR_LABEL];
type ToolErrorStats = { impact: string; users: string[]; recent: { at: number; user: string }[] };
export type PublicRow = { kind: string; fingerprint: string; count: number; firstSeen: number; lastSeen: number; samples: { context: string }[]; toolError?: ToolErrorStats };

/** Occurrences and distinct users within the threshold window, from the row's recent occurrences. */
export function toolErrorWindow(row: Pick<PublicRow, 'toolError'>, now = Date.now()) {
  const recent = row.toolError?.recent.filter(item => item.at > now - TOOL_ERROR_THRESHOLD.windowMs) ?? [];
  return { occurrences: recent.length, users: new Set(recent.map(item => item.user)).size };
}
/** A tool error becomes a public issue only once it repeats: enough occurrences, or more than one user, within the window. */
export function toolErrorDue(row: Pick<PublicRow, 'toolError'>, now = Date.now()) {
  const window = toolErrorWindow(row, now);
  return window.occurrences >= TOOL_ERROR_THRESHOLD.occurrences || window.users >= TOOL_ERROR_THRESHOLD.users;
}

const tools = new Map([...Object.keys(EDITOR_TOOL_DEFINITIONS), ...PROJECT_BASE_TOOLS].map(name => [name.toLowerCase(), name]));
const contextSchema = z.object({ toolName: z.string().optional(), category: z.string().optional(), impact: z.string().optional(), condition: z.string().optional(), inputShape: z.string().optional() });
function latest(row: PublicRow, field: 'toolName' | 'category' | 'impact' | 'condition' | 'inputShape') {
  const values = row.samples.map(sample => { try { return contextSchema.parse(JSON.parse(sample.context))[field] ?? ''; } catch { return ''; } });
  return values.findLast(Boolean) ?? '';
}
const listed = <T extends string>(value: string, allowed: readonly T[]) => allowed.find(item => item === value);

/** Schema issues as the server stored them (path:code pairs); anything else in the field is left out. */
const schemaIssues = (value: string) => value.split(' ').filter(item => /^(?:[A-Za-z_][A-Za-z0-9_]{0,40}|#|\?|\(root\))(?:\.(?:[A-Za-z_][A-Za-z0-9_]{0,40}|#|\?))*:[a-z_]{1,40}$/.test(item)).slice(0, 8);

function toolErrorIssue(row: PublicRow, deployment: 'dev' | 'prod') {
  const kind = row.kind === 'tool-input-invalid' ? 'tool-input-invalid' : 'tool-error';
  const tool = tools.get(latest(row, 'toolName').trim().toLowerCase()) ?? 'unlisted tool';
  const errorClass = listed(latest(row, 'condition'), TOOL_ERROR_CLASSES) ?? 'thrown', impact = listed(row.toolError?.impact ?? '', TOOL_ERROR_IMPACTS) ?? 'not stated';
  const window = toolErrorWindow(row), issues = kind === 'tool-input-invalid' ? schemaIssues(latest(row, 'inputShape')) : [];
  const title = `${kind === 'tool-input-invalid' ? 'Tool input invalid' : 'Tool error'} (${deployment}): ${tool}: ${errorClass} (${row.fingerprint.slice(-8)})`;
  const body = `${ISSUE_KINDS[kind].marker}${deployment}:${row.fingerprint} -->\n${FORMAT}\n${kind === 'tool-input-invalid' ? 'Assistant turns keep sending arguments this tool\'s schema refuses' : 'A tool call in assistant turns keeps returning the same error'} on the ${deployment} deployment. Turns usually recover, so nothing else reports it.\n\n| Field | Value |\n| --- | --- |\n| Category | ${errorClass} |\n| Tool | \`${tool}\` |\n| Impact (latest) | ${impact} |\n| Class | ${kind} |\n${issues.length ? `| Schema issues | ${issues.map(item => `\`${item}\``).join(' ')} |\n` : ''}| Occurrences | ${row.count} |\n| Last 7 days | ${window.occurrences} occurrence${window.occurrences === 1 ? '' : 's'}, ${window.users} user${window.users === 1 ? '' : 's'} |\n| Distinct users | ${row.toolError?.users.length ?? 0}${(row.toolError?.users.length ?? 0) >= 100 ? '+' : ''} |\n| First seen | ${new Date(row.firstSeen).toISOString()} |\n| Latest | ${new Date(row.lastSeen).toISOString()} |\n| Fingerprint | \`${row.fingerprint}\` |\n\nThe error text is normalized and stays private in the deployment's incident record, with no user text or tool arguments. Maintainers read it with \`npm run incidents:tool-errors -- --deployment ${deployment}\`. Comments here are not read by any automation.`;
  if (body.length > 4000 || title.length > 200) throw new Error('Public issue exceeds its fixed size');
  return { title, body, labels: ISSUE_KINDS[kind].labels };
}

export function publicIssue(row: PublicRow, deployment: 'dev' | 'prod') {
  if (isToolErrorKind(row.kind)) return toolErrorIssue(row, deployment);
  const limitation = row.kind === 'agent-limitation', kind: AgentFiledKind = limitation ? 'agent-limitation' : 'agent-report';
  const tool = tools.get(latest(row, 'toolName').trim().toLowerCase()) ?? (limitation ? 'unlisted capability' : 'unlisted tool');
  const category = listed(latest(row, 'category'), LIMITATION_CATEGORIES) ?? 'other', impact = listed(latest(row, 'impact'), LIMITATION_IMPACTS) ?? 'not stated';
  const title = limitation ? `Agent limitation (${deployment}): ${category}: ${tool} (${row.fingerprint.slice(-8)})` : `Agent report (${deployment}): ${tool} (${row.fingerprint.slice(-8)})`;
  const facts = `| Occurrences | ${row.count} |\n| First seen | ${new Date(row.firstSeen).toISOString()} |\n| Latest | ${new Date(row.lastSeen).toISOString()} |\n| Fingerprint | \`${row.fingerprint}\` |`;
  const body = limitation
    ? `${ISSUE_KINDS[kind].marker}${deployment}:${row.fingerprint} -->\n${FORMAT}\nAn editing agent met a product limitation on the ${deployment} deployment: the tools worked as designed but could not do what a user asked.\n\n| Field | Value |\n| --- | --- |\n| Category | ${category} |\n| Impact (latest) | ${impact} |\n| Nearest tool | \`${tool}\` |\n| Class | agent-limitation |\n${facts}\n\nWhat users asked for, the limitation, the workaround used and the wanted capability are model-written text and stay private in the deployment's incident record. Maintainers read them with \`npm run incidents:limitations -- --deployment ${deployment}\`. Comments here are not read by any automation.`
    : `${ISSUE_KINDS[kind].marker}${deployment}:${row.fingerprint} -->\n${FORMAT}\nAn editing agent reported a possible Revline tool defect on the ${deployment} deployment.\n\n| Field | Value |\n| --- | --- |\n| Tool | \`${tool}\` |\n| Class | agent-report |\n${facts}\n\nThe report text is untrusted and stays private in the deployment's incident record; maintainers look it up by fingerprint. Comments here are not read by the automated fixer.`;
  // Rendered whole on every update, so the body never grows with redeliveries.
  if (body.length > 4000 || title.length > 200) throw new Error('Public issue exceeds its fixed size');
  return { title, body, labels: ISSUE_KINDS[kind].labels };
}
