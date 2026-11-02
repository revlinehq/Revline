import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { branchPR, config, readJob, writeJob } from './shared';

const [path, url] = process.argv.slice(2);
if (!path || !url) throw new Error('Usage: record-pr.ts JOB_FILE PR_URL');
const job = await readJob(path);
const pr = await branchPR(job.branch);
if (!pr || pr.url !== url || !pr.body.includes(job.incident.fingerprint)) throw new Error('Expected a draft incident PR on the job branch with its fingerprint');
const endpoint = (await config()).endpoints.find(item => item.deployment === job.incident.deployment);
if (!endpoint) throw new Error('Missing endpoint');
await new ConvexHttpClient(endpoint.url).mutation(api.incidents.recordPR, { secret: endpoint.secret, id: job.incident._id as Id<'incidents'>, generation: job.incident.generation, claimToken: job.claimToken, prUrl: url });
await writeJob(path, { ...job, prUrl: url });
console.info(`Incident PR recorded: ${url}`);
