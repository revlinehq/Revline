import { z } from 'zod';
import { EDITOR_TOOL_DEFINITIONS } from '../../lib/ai/tool-definitions';
import { PROJECT_BASE_TOOLS } from '../../lib/ai/lanes/base-tools';
import { LIMITATION_CATEGORIES, LIMITATION_IMPACTS, type AgentFiledKind } from '../../lib/incidents';

// The repository is public. An issue carries only structured facts the server
// controls: an allow-listed tool name, enum values, counts, times and fingerprint.
// Report text, requests, workarounds, messages and project identifiers stay private in Convex.
export const FORMAT = '<!-- revline-issue-format:2 -->';
export const ISSUE_KINDS: Record<AgentFiledKind, { marker: string; labels: string[] }> = {
  'agent-report': { marker: '<!-- revline-agent-report:', labels: [] },
  'agent-limitation': { marker: '<!-- revline-agent-limitation:', labels: ['limitation'] },
};
export const LIMITATION_LABEL = { name: 'limitation', color: 'd4c5f9', description: 'A product limit an editing agent met while doing what a user asked' };
export type PublicRow = { kind: string; fingerprint: string; count: number; firstSeen: number; lastSeen: number; samples: { context: string }[] };

const tools = new Map([...Object.keys(EDITOR_TOOL_DEFINITIONS), ...PROJECT_BASE_TOOLS].map(name => [name.toLowerCase(), name]));
const contextSchema = z.object({ toolName: z.string().optional(), category: z.string().optional(), impact: z.string().optional() });
function latest(row: PublicRow, field: 'toolName' | 'category' | 'impact') {
  const values = row.samples.map(sample => { try { return contextSchema.parse(JSON.parse(sample.context))[field] ?? ''; } catch { return ''; } });
  return values.findLast(Boolean) ?? '';
}
const listed = <T extends string>(value: string, allowed: readonly T[]) => allowed.find(item => item === value);

export function publicIssue(row: PublicRow, deployment: 'dev' | 'prod') {
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
