import type { FunctionReturnType } from 'convex/server';
import { ConvexHttpClient } from 'convex/browser';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { api } from '../../convex/_generated/api';
import { incidentText } from '../../lib/incidents';
import { config, githubToken, repo, run } from './shared';

const { values } = parseArgs({ options: {
  dispatch: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false }, deployment: { type: 'string' }, deliver: { type: 'boolean', default: false },
  backfill: { type: 'boolean', default: false }, limit: { type: 'string', default: '10' },
} });
const deployment = z.enum(['dev', 'prod']).parse(values.deployment);
const limit = z.coerce.number().int().min(1).max(100).parse(values.limit);
const endpoint = (await config()).endpoints.find(item => item.deployment === deployment);
if (!endpoint) throw new Error('Deployment is not configured');
const client = new ConvexHttpClient(endpoint.url);
const secret = endpoint.secret;
function diagnostic(context: string) {
  const fields = z.object({ location: z.string().optional(), toolName: z.string().optional(), happened: z.string().optional(), expected: z.string().optional() }).parse(JSON.parse(context));
  return Object.entries(fields).map(([key, value]) => `${key}: ${incidentText(value ?? '', 600)}`).join('\n');
}
const issueSchema = z.object({ state: z.enum(['open', 'closed']), body: z.string().nullable(), html_url: z.string().url(), pull_request: z.unknown().optional() });
async function github(args: string[]) {
  return await run('gh', args, { env: { ...process.env, GH_TOKEN: await githubToken() }, timeout: 60_000, maxBuffer: 32_000_000 });
}
// List all states directly: search indexing can lag behind a successful create.
// Fail closed if any page fails; never create without a complete reconciliation.
async function existingIssues() {
  const { stdout } = await github(['api', '--paginate', '--slurp', `repos/${repo}/issues?state=all&per_page=100`]);
  return z.array(z.array(issueSchema)).parse(JSON.parse(stdout)).flat().filter(issue => !issue.pull_request);
}
do {
try {
  let cursor: string | null = null;
  let eligible = 0;
  let attempted = 0;
  let delivered = 0;
  let dispatchReady = 0;
  const issues = (values.deliver || values.dispatch) ? await existingIssues() : [];
  do {
    const page: FunctionReturnType<typeof api.incidents.issueQueue> = await client.query(api.incidents.issueQueue, { secret, paginationOpts: { cursor, numItems: 100 } });
    for (const row of page.page) {
      if (row.deployment !== deployment) throw new Error('Incident deployment mismatch');
      if (values.dispatch && row.issueUrl && !row.prUrl && row.status !== 'resolved' && !row.issueDispatchReady && issues.some(issue => issue.html_url === row.issueUrl && issue.state === 'open') && dispatchReady < Math.min(2, limit)) {
        dispatchReady++;
        if (values.deliver) await client.mutation(api.incidents.dispatchIssue, { secret, id: row._id, generation: row.generation });
      }
      if ((row.issueUrl && (row.issueDeliveredCount ?? 0) >= row.count) || (row.issueAttempts === undefined && !values.backfill) ||
        (row.issueAttempts ?? 0) >= 5 || (row.issueNextAttempt ?? 0) > Date.now() ||
        (row.issueDelivery === 'claimed' && (row.issueClaimedAt ?? 0) > Date.now() - 600_000)) continue;
      eligible++;
      if (!values.deliver || attempted >= limit) continue;
      const args = { secret, id: row._id, generation: row.generation, claimToken: crypto.randomUUID() };
      if (!await client.mutation(api.incidents.claimIssue, { ...args, backfill: values.backfill })) continue;
      attempted++;
      try {
        const marker = `<!-- revline-agent-report:${deployment}:${row.fingerprint} -->`;
        let issueUrl = row.issueUrl ?? issues.find(issue => issue.body?.includes(marker))?.html_url;
        {
          // Only scrubbed diagnostic text is public; no raw context, prompts or local logs.
          const evidence = `${marker}\nAgent report saved in ${deployment}. Occurrences: ${row.count}. Incident: ${row._id}. Fingerprint: ${row.fingerprint}. First seen: ${new Date(row.firstSeen).toISOString()}. Latest: ${new Date(row.lastSeen).toISOString()}.\n\n${incidentText(row.message)}\n\nLatest diagnostic:\n${row.samples.map(sample => `${new Date(sample.at).toISOString()}: ${diagnostic(sample.context)}`).join('\n')}`;
          const previous = issues.find(issue => issue.html_url === issueUrl);
          const occurrenceMarker = `<!-- occurrence:${row._id}:${row.count} -->`;
          const body = previous?.body?.includes(occurrenceMarker) ? previous.body : `${previous?.body ?? ''}\n${occurrenceMarker}\n${evidence}`;
          const { stdout } = await github(['api', '--method', issueUrl ? 'PATCH' : 'POST', issueUrl ? `repos/${repo}/issues/${issueUrl.split('/').at(-1)}` : `repos/${repo}/issues`, '-f', `title=Agent report (${deployment}): ${incidentText(row.message, 160)}`, '-f', `body=${body}`]);
          const created = issueSchema.parse(JSON.parse(stdout));
          const previousIndex = issues.findIndex(issue => issue.html_url === created.html_url);
          if (previousIndex >= 0) issues.splice(previousIndex, 1);
          issues.push(created);
          issueUrl = created.html_url;
        }
        await client.mutation(api.incidents.finishIssue, { ...args, issueUrl, count: row.count });
        delivered++;
      } catch {
        // Never print subprocess errors: they can contain credentials or request bodies.
        await client.mutation(api.incidents.finishIssue, { ...args, count: row.count });
        // Stop this run after an ambiguous failure. Next run reconciles GitHub first.
        break;
      }
    }
    cursor = page.isDone ? null : page.continueCursor;
    if (attempted > delivered) break;
  } while (cursor);
  console.info(JSON.stringify({ deployment, dryRun: !values.deliver, backfill: values.backfill, eligible, limit, attempted, delivered, dispatchReady }));
} catch {
  console.error('Issue delivery stopped; check private GitHub authentication and deployment-specific listener configuration.');
  process.exitCode = 1;
}

  if (values.watch) await setTimeout(60_000);
} while (values.watch);
