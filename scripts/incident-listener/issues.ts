import type { FunctionReturnType } from 'convex/server';
import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { api } from '../../convex/_generated/api';
import { EDITOR_TOOL_DEFINITIONS } from '../../lib/ai/tool-definitions';
import { PROJECT_BASE_TOOLS } from '../../lib/ai/lanes/base-tools';
import { publisherConfig, githubToken, repo, run } from './shared';

const { values } = parseArgs({ options: {
  dispatch: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false }, deployment: { type: 'string' }, deliver: { type: 'boolean', default: false },
  backfill: { type: 'boolean', default: false }, limit: { type: 'string', default: '10' }, preview: { type: 'boolean', default: false },
} });
const deployment = z.enum(['dev', 'prod']).parse(values.deployment);
const limit = z.coerce.number().int().min(1).max(100).parse(values.limit);
const endpoint = (await publisherConfig()).endpoints.find(item => item.deployment === deployment);
if (!endpoint) throw new Error('Deployment is not configured');
const client = new ConvexHttpClient(endpoint.url);
const secret = endpoint.secret;
type Row = FunctionReturnType<typeof api.incidents.issueQueue>['page'][number];
const issueSchema = z.object({ state: z.enum(['open', 'closed']), body: z.string().nullable(), html_url: z.string().url(), created_at: z.string(), author_association: z.string(), user: z.object({ login: z.string() }).nullable(), pull_request: z.unknown().optional() });
type Issue = z.infer<typeof issueSchema>;

// The repository is public. An issue carries only structured facts the server
// controls: an allow-listed tool name, class, counts, times and fingerprint.
// Report text, inputs, messages and project identifiers stay private in Convex.
const FORMAT = '<!-- revline-issue-format:2 -->';
const MARKER = '<!-- revline-agent-report:';
const tools = new Set<string>([...Object.keys(EDITOR_TOOL_DEFINITIONS), ...PROJECT_BASE_TOOLS]);
function toolName(row: Row) {
  const names = row.samples.map(sample => { try { return z.object({ toolName: z.string() }).parse(JSON.parse(sample.context)).toolName; } catch { return ''; } });
  const name = names.findLast(Boolean) ?? '';
  return tools.has(name) ? name : 'unlisted tool';
}
function publicIssue(row: Row) {
  const tool = toolName(row);
  const title = `Agent report (${deployment}): ${tool} (${row.fingerprint.slice(-8)})`;
  const body = `${MARKER}${deployment}:${row.fingerprint} -->\n${FORMAT}\nAn editing agent reported a possible Revline tool defect on the ${deployment} deployment.\n\n| Field | Value |\n| --- | --- |\n| Tool | \`${tool}\` |\n| Class | agent-report |\n| Occurrences | ${row.count} |\n| First seen | ${new Date(row.firstSeen).toISOString()} |\n| Latest | ${new Date(row.lastSeen).toISOString()} |\n| Fingerprint | \`${row.fingerprint}\` |\n\nThe report text is untrusted and stays private in the deployment's incident record; maintainers look it up by fingerprint. Comments here are not read by the automated fixer.`;
  // Rendered whole on every update, so the body never grows with redeliveries.
  if (body.length > 4000 || title.length > 200) throw new Error('Public issue exceeds its fixed size');
  return { title, body };
}
// Global cap on new public issues across deployments, counted from GitHub itself so
// restarts cannot reset it. Updates to existing issues are bounded by --limit.
const NEW_ISSUE_LIMITS = [{ windowMs: 3_600_000, limit: 5 }, { windowMs: 86_400_000, limit: 20 }];
function mayCreate(issues: Issue[], ours: (issue: Issue) => boolean) {
  const created = issues.filter(ours).map(issue => Date.parse(issue.created_at));
  return NEW_ISSUE_LIMITS.every(({ windowMs, limit }) => created.filter(at => at > Date.now() - windowMs).length < limit);
}
async function github(args: string[]) {
  return await run('gh', args, { env: { ...process.env, GH_TOKEN: await githubToken() }, timeout: 60_000, maxBuffer: 32_000_000 });
}
async function writeIssue(issueUrl: string | undefined, row: Row) {
  const { title, body } = publicIssue(row);
  const { stdout } = await github(['api', '--method', issueUrl ? 'PATCH' : 'POST', issueUrl ? `repos/${repo}/issues/${issueUrl.split('/').at(-1)}` : `repos/${repo}/issues`, '-f', `title=${title}`, '-f', `body=${body}`]);
  return issueSchema.parse(JSON.parse(stdout));
}
// List all states directly: search indexing can lag behind a successful create.
// Fail closed if any page fails; never create without a complete reconciliation.
async function existingIssues() {
  const { stdout } = await github(['api', '--paginate', '--slurp', `repos/${repo}/issues?state=all&per_page=100`]);
  return z.array(z.array(issueSchema)).parse(JSON.parse(stdout)).flat().filter(issue => !issue.pull_request);
}
const publisherLogin = async () => z.object({ login: z.string() }).parse(JSON.parse((await github(['api', 'user'])).stdout)).login;
do {
try {
  let cursor: string | null = null;
  let eligible = 0;
  let attempted = 0;
  let delivered = 0;
  let dispatchReady = 0;
  let scrubbed = 0;
  let deferred = 0;
  let missing = 0;
  let ambiguous = false;
  const [issues, self] = (values.deliver || values.dispatch) ? await Promise.all([existingIssues(), publisherLogin()]) : [[], ''];
  // Anyone can open an issue on the public repository. Only the publisher's or a
  // maintainer's issue counts, so a copied marker cannot claim a report or use up the cap.
  const ours = (issue: Issue) => (issue.user?.login === self || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(issue.author_association)) && !!issue.body?.includes(MARKER);
  const remember = (issue: Issue) => {
    const previousIndex = issues.findIndex(item => item.html_url === issue.html_url);
    if (previousIndex >= 0) issues.splice(previousIndex, 1);
    issues.push(issue);
  };
  do {
    const page: FunctionReturnType<typeof api.incidents.issueQueue> = await client.query(api.incidents.issueQueue, { secret, paginationOpts: { cursor, numItems: 100 } });
    for (const row of page.page) {
      if (row.deployment !== deployment) throw new Error('Incident deployment mismatch');
      const savedIssueUrl = row.issueUrl?.replace(/^https:\/\/github\.com\/zuraHQ\/(?:Revline|revline-editor)\//, `https://github.com/${repo}/`);
      const marker = `${MARKER}${deployment}:${row.fingerprint} -->`;
      const byMarker = () => issues.find(issue => ours(issue) && issue.body?.includes(marker));
      if (values.dispatch && row.issueUrl && !row.prUrl && row.status !== 'resolved' && !row.issueDispatchReady && issues.some(issue => issue.html_url === savedIssueUrl && issue.state === 'open') && dispatchReady < Math.min(2, limit)) {
        dispatchReady++;
        if (values.deliver) await client.mutation(api.incidents.dispatchIssue, { secret, id: row._id, generation: row.generation });
      }
      if ((row.issueUrl && (row.issueDeliveredCount ?? 0) >= row.count) || (row.issueAttempts === undefined && !values.backfill) ||
        (row.issueAttempts ?? 0) >= 5 || (row.issueNextAttempt ?? 0) > Date.now() ||
        (row.issueDelivery === 'claimed' && (row.issueClaimedAt ?? 0) > Date.now() - 600_000)) {
        // Earlier publishers appended scrubbed report text. Replace each such public body
        // once; no claim is needed because an update cannot create a duplicate issue.
        const published = !values.deliver ? undefined : savedIssueUrl ? issues.find(issue => issue.html_url === savedIssueUrl) : byMarker();
        if (published && !published.body?.includes(FORMAT) && scrubbed < limit) {
          scrubbed++;
          try { remember(await writeIssue(published.html_url, row)); } catch { /* Retried on the next pass. */ }
        }
        continue;
      }
      eligible++;
      if (values.preview && !values.deliver && eligible <= limit) console.info(JSON.stringify(publicIssue(row)));
      if (!values.deliver || attempted >= limit) continue;
      // A saved issue absent from the complete listing was deleted: never patch or recreate it.
      if (savedIssueUrl && !issues.some(issue => issue.html_url === savedIssueUrl)) { missing++; continue; }
      let issueUrl = savedIssueUrl ?? byMarker()?.html_url;
      if (!issueUrl && !mayCreate(issues, ours)) { deferred++; continue; }
      const args = { secret, id: row._id, generation: row.generation, claimToken: crypto.randomUUID() };
      if (!await client.mutation(api.incidents.claimIssue, { ...args, backfill: values.backfill })) continue;
      attempted++;
      const creating = !issueUrl;
      try {
        const written = await writeIssue(issueUrl, row);
        remember(written);
        issueUrl = written.html_url;
        try {
          await client.mutation(api.incidents.finishIssue, { ...args, issueUrl, count: row.count });
        } catch (error) {
          // Older deployed backends accept only the repository's redirect URL.
          if (!(error instanceof ConvexError) || error.data !== 'Invalid incident issue') throw error;
          await client.mutation(api.incidents.finishIssue, { ...args, issueUrl: issueUrl.replace(`https://github.com/${repo}/`, 'https://github.com/zuraHQ/revline-editor/'), count: row.count });
        }
        delivered++;
      } catch {
        // Never print subprocess errors: they can contain credentials or request bodies.
        await client.mutation(api.incidents.finishIssue, { ...args, count: row.count });
        // A failed create may still have succeeded on GitHub: stop, and reconcile first
        // on the next run. A failed update cannot duplicate, so later rows continue.
        if (creating) { ambiguous = true; break; }
      }
    }
    cursor = page.isDone ? null : page.continueCursor;
    if (ambiguous) break;
  } while (cursor);
  console.info(JSON.stringify({ deployment, dryRun: !values.deliver, backfill: values.backfill, eligible, limit, attempted, delivered, scrubbed, deferred, missing, dispatchReady }));
} catch {
  console.error('Issue delivery stopped; check private GitHub authentication and deployment-specific listener configuration.');
  process.exitCode = 1;
}

  if (values.watch) await setTimeout(60_000);
} while (values.watch);
