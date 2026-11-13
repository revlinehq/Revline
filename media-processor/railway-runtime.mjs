import { readFile, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { railwayConfig } from '../lib/railway-workers.mjs';

const config = railwayConfig(process.env.RAILWAY_WORKERS_JSON);
if (process.platform !== 'linux' || process.env.RAILWAY_PROJECT_ID !== config.projectId || process.env.RAILWAY_ENVIRONMENT_ID !== config.environmentId || !process.env.RAILWAY_SERVICE_ID) throw new Error('Railway runtime/environment identity is invalid.');
if (process.env.NEXT_PUBLIC_CONVEX_URL !== config.convexUrl || process.env.MEDIA_WORKER_CONCURRENCY !== '1') throw new Error('Railway worker queue/slot configuration is invalid.');
// The role is the Docker target this image was built from, never a variable that can go stale.
const role = process.env.REVLINE_BUILD_ROLE;
if (role !== 'processor' && role !== 'exports') throw new Error('Railway image was not built from a railway-processor or railway-exports target.');
// The commit this container runs: Railway's own for a GitHub autodeploy, else the one baked into a registry image.
// It is reported, never compared with a pinned value: Railway decides which commit runs (docs/releases.md, Railway).
const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.REVLINE_BUILD_COMMIT || 'unknown';
const image = process.env.REVLINE_RAILWAY_IMAGE;
if (process.env.REVLINE_CHUNK_INDEX !== undefined) {
  // Distributed export chunks are temporary services that run the pinned export image.
  if (role !== 'exports' || !config.exportsImage || image !== config.exportsImage) throw new Error('Railway chunks require the pinned export image.');
} else if (process.env.REVLINE_RAILWAY_MODE !== 'preflight') {
  const exportsLane = process.env.MEDIA_RENDERS_ONLY === 'true';
  if (exportsLane !== (role === 'exports')) throw new Error(`Railway slot runs the ${role} image but is configured as ${exportsLane ? 'an export' : 'a processor'} lane (REVLINE_FINAL_TARGET).`);
  const slots = exportsLane ? (process.env.MEDIA_LANE === 'ultra' ? config.ultraServices : config.standardServices) : config.processorServices;
  if (!slots.includes(process.env.RAILWAY_SERVICE_ID)) throw new Error('Railway service is not a configured queue slot.');
}
// Check the actual cgroup, including preflights and chunks, before loading models
// or opening a queue connection. Never trust the account plan's default ceiling.
const [quota, period] = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(/\s+/).map(Number);
const memory = Number((await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim());
if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0 || !Number.isFinite(memory) || memory <= 0) throw new Error('Railway CPU and memory allocation must be finite, positive and verifiable.');
const disk = await statfs(process.env.TMPDIR || '/tmp');
if (disk.bavail * disk.bsize < 20 * 1024 ** 3) throw new Error('Railway scratch needs at least 20 GiB free; use a paid plan with sufficient ephemeral storage.');
execFileSync(process.execPath, ['media-processor/runtime-check.mjs'], { stdio: 'inherit' });
console.log(JSON.stringify({ event: 'railway-runtime-verified', commit, role, image, source: process.env.RAILWAY_GIT_COMMIT_SHA ? 'github' : 'image', cpus: quota / period, memoryBytes: memory, environment: config.environment }));
