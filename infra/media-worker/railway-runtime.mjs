import { readFile, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { railwayConfig } from '../../lib/railway-workers.mjs';

const config = railwayConfig(process.env.RAILWAY_WORKERS_JSON);
if (process.platform !== 'linux' || process.env.RAILWAY_PROJECT_ID !== config.projectId || process.env.RAILWAY_ENVIRONMENT_ID !== config.environmentId || !process.env.RAILWAY_SERVICE_ID) throw new Error('Railway runtime/environment identity is invalid.');
if (process.env.NEXT_PUBLIC_CONVEX_URL !== config.convexUrl || process.env.MEDIA_WORKER_CONCURRENCY !== '1') throw new Error('Railway worker queue/slot configuration is invalid.');
const image = process.env.REVLINE_RAILWAY_IMAGE;
const role = image === config.processorImage ? 'processor' : 'exports';
const commit = role === 'processor' ? config.processorCommit : config.exportsCommit;
if (process.env.REVLINE_BUILD_ROLE !== role) throw new Error('Railway Docker build target does not match its worker role.');
if (process.env.REVLINE_BUILD_COMMIT !== commit || (process.env.RAILWAY_GIT_COMMIT_SHA && process.env.RAILWAY_GIT_COMMIT_SHA !== commit)) throw new Error('Railway build revision differs from the verified artifact revision.');
if (image !== config.processorImage && image !== config.exportsImage) throw new Error('Railway image is not pinned in this environment manifest.');
if (process.env.REVLINE_CHUNK_INDEX !== undefined) {
  if (image !== config.exportsImage) throw new Error('Railway chunks require the export image.');
} else if (process.env.REVLINE_RAILWAY_MODE !== 'preflight') {
  const slots = process.env.MEDIA_RENDERS_ONLY === 'true'
    ? (process.env.MEDIA_LANE === 'ultra' ? config.ultraServices : config.standardServices)
    : config.processorServices;
  if (!slots.includes(process.env.RAILWAY_SERVICE_ID)) throw new Error('Railway service is not a configured queue slot.');
}
// Check the actual cgroup, including preflights and chunks, before loading models
// or opening a queue connection. Never trust the account plan's default ceiling.
const [quota, period] = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(/\s+/).map(Number);
const memory = Number((await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim());
if (!Number.isFinite(quota) || quota <= 0 || !period || quota / period > 4 || !Number.isFinite(memory) || memory <= 0 || memory > 8192 * 1024 * 1024) throw new Error('Railway cgroup exceeds 4 CPUs / 8192 MiB, or limits cannot be verified.');
const disk = await statfs(process.env.TMPDIR || '/tmp');
if (disk.bavail * disk.bsize < 20 * 1024 ** 3) throw new Error('Railway scratch needs at least 20 GiB free; use a paid plan with sufficient ephemeral storage.');
execFileSync(process.execPath, ['infra/media-worker/runtime-check.mjs'], { stdio: 'inherit' });
console.log(JSON.stringify({ event: 'railway-runtime-verified', commit, role, image: process.env.REVLINE_RAILWAY_IMAGE, cpus: quota / period, memoryBytes: memory, environment: config.environment }));
