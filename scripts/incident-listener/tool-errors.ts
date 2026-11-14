// Private triage view of tool errors in assistant turns: the most frequent fingerprints, with their normalized error
// text, which never goes to a public issue. Prints to this terminal only.
// Usage: npm run incidents:tool-errors -- --deployment prod [--limit 30] [--kind tool-error|tool-input-invalid] [--json]
import type { FunctionReturnType } from 'convex/server';
import { ConvexHttpClient } from 'convex/browser';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { api } from '../../convex/_generated/api';
import { TOOL_ERROR_KINDS } from '../../lib/incidents';
import { toolErrorDue, toolErrorWindow } from './public-issue';
import { publisherConfig } from './shared';

const { values } = parseArgs({ options: { deployment: { type: 'string' }, limit: { type: 'string', default: '30' }, kind: { type: 'string' }, json: { type: 'boolean', default: false } } });
const deployment = z.enum(['dev', 'prod']).parse(values.deployment);
const limit = z.coerce.number().int().min(1).max(500).parse(values.limit);
const kinds = values.kind ? [z.enum(TOOL_ERROR_KINDS).parse(values.kind)] : [...TOOL_ERROR_KINDS];
const endpoint = (await publisherConfig()).endpoints.find(item => item.deployment === deployment);
if (!endpoint) throw new Error('Deployment is not configured');
const client = new ConvexHttpClient(endpoint.url);
type Page = FunctionReturnType<typeof api.incidents.issueQueue>;
const rows: Page['page'] = [];
for (const kind of kinds) {
  let cursor: string | null = null;
  do {
    const page: Page = await client.query(api.incidents.issueQueue, { secret: endpoint.secret, kind, paginationOpts: { cursor, numItems: 100 } });
    rows.push(...page.page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
}
const text = z.string().optional().catch(undefined);
const contextSchema = z.object({ toolName: text, condition: text, inputShape: text, location: text });
const shown = rows.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, limit).map(row => {
  const context: z.infer<typeof contextSchema> = {};
  for (const sample of row.samples) {
    try { Object.assign(context, Object.fromEntries(Object.entries(contextSchema.parse(JSON.parse(sample.context))).filter(([, value]) => value))); } catch { /* An unreadable sample still lists the row. */ }
  }
  const window = toolErrorWindow(row);
  return { count: row.count, kind: row.kind, tool: context.toolName, errorClass: context.condition, message: row.message, schemaIssues: context.inputShape, impact: row.toolError?.impact, surface: row.toolError?.surface, users: row.toolError?.users.length ?? 0, last7Days: window, due: toolErrorDue(row), firstSeen: new Date(row.firstSeen).toISOString(), lastSeen: new Date(row.lastSeen).toISOString(), issue: row.issueUrl, fingerprint: row.fingerprint };
});
if (values.json) console.info(JSON.stringify(shown, null, 2));
else for (const row of shown) console.info(`\n${row.count}× ${row.kind} / ${row.tool ?? 'unknown tool'} / ${row.errorClass ?? 'unclassed'}  (${row.fingerprint.slice(-8)})\n  Error:      ${row.message}${row.schemaIssues ? `\n  Schema:     ${row.schemaIssues}` : ''}\n  Users:      ${row.users}${row.users >= 100 ? '+' : ''} distinct; last 7 days ${row.last7Days.occurrences} occurrences from ${row.last7Days.users} users${row.due ? ' (over the issue threshold)' : ''}\n  Impact:     ${row.impact ?? 'not stated'} (latest, ${row.surface ?? 'unknown'} turn)\n  Seen:       ${row.firstSeen} to ${row.lastSeen}\n  Issue:      ${row.issue ?? 'not published yet'}`);
console.info(`\n${rows.length} tool error${rows.length === 1 ? '' : 's'} on ${deployment}, most frequent first.`);
