// Private triage view of agent-reported product limitations: the text that never goes to the public issue.
// Prints to this terminal only. Usage: npm run incidents:limitations -- --deployment prod [--limit 30] [--json]
import type { FunctionReturnType } from 'convex/server';
import { ConvexHttpClient } from 'convex/browser';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { api } from '../../convex/_generated/api';
import { publisherConfig } from './shared';

const { values } = parseArgs({ options: { deployment: { type: 'string' }, limit: { type: 'string', default: '30' }, json: { type: 'boolean', default: false } } });
const deployment = z.enum(['dev', 'prod']).parse(values.deployment);
const limit = z.coerce.number().int().min(1).max(500).parse(values.limit);
const endpoint = (await publisherConfig()).endpoints.find(item => item.deployment === deployment);
if (!endpoint) throw new Error('Deployment is not configured');
const client = new ConvexHttpClient(endpoint.url);
type Row = FunctionReturnType<typeof api.incidents.issueQueue>['page'][number];
const rows: Row[] = [];
let cursor: string | null = null;
do {
  const page: FunctionReturnType<typeof api.incidents.issueQueue> = await client.query(api.incidents.issueQueue, { secret: endpoint.secret, kind: 'agent-limitation', paginationOpts: { cursor, numItems: 100 } });
  rows.push(...page.page);
  cursor = page.isDone ? null : page.continueCursor;
} while (cursor);
const text = z.string().optional().catch(undefined);
const contextSchema = z.object({ toolName: text, request: text, limitation: text, category: text, workaround: text, impact: text, wanted: text, lane: text, model: text });
const shown = rows.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, limit).map(row => {
  // Each field is its latest stated value: a later sample without a workaround keeps an earlier one's.
  const context: z.infer<typeof contextSchema> = {};
  for (const sample of row.samples) {
    try { Object.assign(context, Object.fromEntries(Object.entries(contextSchema.parse(JSON.parse(sample.context))).filter(([, value]) => value))); } catch { /* An unreadable sample still lists the row. */ }
  }
  return { count: row.count, category: context.category, impact: context.impact, tool: context.toolName, limitation: context.limitation, wanted: context.wanted, workaround: context.workaround, request: context.request, lane: context.lane, model: context.model, firstSeen: new Date(row.firstSeen).toISOString(), lastSeen: new Date(row.lastSeen).toISOString(), issue: row.issueUrl, fingerprint: row.fingerprint };
});
if (values.json) console.info(JSON.stringify(shown, null, 2));
else for (const row of shown) console.info(`\n${row.count}× ${row.category ?? 'other'} / ${row.impact ?? 'impact not stated'} / ${row.tool ?? 'no tool'}  (${row.fingerprint.slice(-8)})\n  Limitation: ${row.limitation ?? ''}\n  Wanted:     ${row.wanted ?? 'not stated'}\n  Workaround: ${row.workaround ?? 'not stated'}\n  Asked for:  ${row.request ?? ''}  [latest of ${row.count}; ${row.lane ?? 'lane unknown'}, ${row.model ?? 'agent unknown'}]\n  Seen:       ${row.firstSeen} to ${row.lastSeen}\n  Issue:      ${row.issue ?? 'not published yet'}`);
console.info(`\n${rows.length} limitation${rows.length === 1 ? '' : 's'} on ${deployment}, most frequent first.`);
