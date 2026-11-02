import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const state = join(homedir(), '.revline-incidents');
export const configFile = join(state, 'config.json');
export const githubToken = () => readFile(join(state, 'github-token'), 'utf8').then(value => value.trim());
export const endpointSchema = z.object({ deployment: z.enum(['dev', 'prod']), url: z.enum(['https://majestic-alpaca-541.convex.cloud', 'https://different-gnu-398.convex.cloud']), secret: z.string().min(32) }).refine(value => value.url === (value.deployment === 'dev' ? 'https://majestic-alpaca-541.convex.cloud' : 'https://different-gnu-398.convex.cloud'));
export const configSchema = z.object({ repoRoot: z.string(), codex: z.string(), endpoints: z.array(endpointSchema).length(2) });
export const config = () => readFile(configFile, 'utf8').then(text => configSchema.parse(JSON.parse(text)));
export const incidentSchema = z.object({
  _id: z.string(), fingerprint: z.string().regex(/^incident-v1-[a-f0-9]{64}$/), generation: z.number().int().positive(),
  source: z.string(), kind: z.string(), message: z.string(), stack: z.string().optional(), deployment: z.enum(['dev', 'prod']),
  count: z.number(), firstSeen: z.number(), lastSeen: z.number(), priority: z.number(), prUrl: z.string().optional(),
  samples: z.array(z.object({ at: z.number(), context: z.string(), projectId: z.string().optional(), runId: z.string().optional() })),
});
export const jobSchema = z.object({ incident: incidentSchema, claimToken: z.string(), branch: z.string(), directory: z.string(), phase: z.enum(['starting', 'running', 'finished', 'failed']), workerPid: z.number().optional(), codexPid: z.number().optional(), prUrl: z.string().optional() });
export type Job = z.infer<typeof jobSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export async function writeJob(path: string, job: Job) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}
export const readJob = (path: string) => readFile(path, 'utf8').then(text => jobSchema.parse(JSON.parse(text)));
export function alive(pid: number | undefined) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
export const run = promisify(execFile);
export const repo = 'zuraHQ/revline-editor';
const prSchema = z.object({ url: z.string().url(), state: z.string(), isDraft: z.boolean(), headRefName: z.string(), body: z.string(), title: z.string() });
async function github(args: string[]) {
  return await run('gh', args, { env: { ...process.env, GH_TOKEN: await githubToken() }, timeout: 180_000, maxBuffer: 4_000_000 });
}
export async function openPRs() {
  const { stdout } = await github(['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'url,state,isDraft,headRefName,body,title', '--limit', '1000']);
  return z.array(prSchema).parse(JSON.parse(stdout));
}
export async function branchPR(branch: string) {
  const { stdout } = await github(['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch, '--json', 'url,state,isDraft,headRefName,body,title']);
  return z.array(prSchema).parse(JSON.parse(stdout)).find(pr => pr.headRefName === branch && pr.isDraft && pr.title.startsWith('Incident: '));
}

export function launchCodex(binary: string, directory: string, brief: string, logFd: number, token: string) {
  // Give Sol public build settings and ordinary user tooling. Deployment files stay separate.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (!/^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|TERM|CODEX_HOME)$/.test(key)) delete env[key];
  env.GH_TOKEN = token;
  const child = spawn(binary, ['exec', '--dangerously-bypass-approvals-and-sandbox', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=xhigh', '-c', 'features.apps=false', '-c', 'mcp_servers={}', '-C', directory, '-'], { cwd: directory, env, stdio: ['pipe', logFd, logFd], detached: true });
  child.stdin?.end(brief);
  return child;
}
