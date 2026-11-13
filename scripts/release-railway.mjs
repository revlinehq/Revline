import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { RailwayRateLimitError, railway, railwayConfig, railwayInstance, railwayDeployments, railwayDeploymentCommit, railwayGoodDeployment, railwaySlotSource, verifyRailwayTarget, verifyRailwaySlot } from '../lib/railway-workers.mjs';
import { REPOSITORY, isRevlineRepository } from '../lib/repository.mjs';

// Railway processor and export slots deploy from GitHub main on every merge (Railway autodeploy). No release builds,
// pins or stages them; a release only reads which commit each slot actually runs. Rollback: docs/releases.md.

/** What each slot of `kind` runs now, read from Railway: the build a cold start uses (the newest that built and ran),
 *  the latest deployment and its status, and the slot's source.
 * @param {{ values: Record<string, string>, kind: 'processor' | 'exports' }} args */
export async function railwayRunning({ values, kind }) {
  const config = railwayConfig(values.RAILWAY_WORKERS_JSON), token = values.RAILWAY_API_TOKEN;
  await verifyRailwayTarget({ token, config });
  const lanes = kind === 'processor' ? [['processor', config.processorServices]] : [['standard', config.standardServices], ['ultra', config.ultraServices]];
  const slots = [];
  for (const [lane, ids] of lanes) for (const serviceId of ids) {
    const instance = await railwayInstance({ token, config, serviceId });
    const deployments = await railwayDeployments({ token, config, serviceId, first: 10 });
    const good = railwayGoodDeployment(deployments);
    const latest = deployments[0] ?? instance.latestDeployment;
    slots.push({ lane, serviceId, serviceName: instance.serviceName, source: railwaySlotSource(instance), image: instance.source?.image ?? null,
      commit: railwayDeploymentCommit(good), latestCommit: railwayDeploymentCommit(latest), latestStatus: latest?.status ?? null });
  }
  return slots;
}

/** The commit a release can count on for `kind`: the one every slot's cold start runs, or null when they differ or
 *  none is known (an image slot names no commit). */
export const runningCommit = slots => {
  const commits = new Set(slots.map(slot => slot.commit));
  return commits.size === 1 && !commits.has(null) ? [...commits][0] : null;
};

/** Called where releases used to stage Railway: prints what runs and returns its commit. */
export async function releaseRailway({ target, kind, values, dry }) {
  if (dry) { console.log(`${target.name}: Railway ${kind} deploys from GitHub main by itself; the release reads which commit each slot runs.`); return null; }
  const slots = await railwayRunning({ values, kind });
  for (const slot of slots) console.log(`Railway ${target.name} ${slot.lane} ${slot.serviceName}: runs ${slot.commit?.slice(0, 8) ?? (slot.image ?? 'unknown')}; latest deployment ${slot.latestCommit?.slice(0, 8) ?? '-'} ${slot.latestStatus ?? 'none'} (source ${slot.source}).`);
  return runningCommit(slots);
}

export async function verifyRailway({ deployment, kind, values }) {
  const config = railwayConfig(values.RAILWAY_WORKERS_JSON), token = values.RAILWAY_API_TOKEN;
  if (config.convexUrl !== `https://${deployment}.convex.cloud`) throw new Error('Verify Railway/Convex target mismatch.');
  await verifyRailwayTarget({ token, config });
  const slots = kind === 'processor' ? config.processorServices : [...config.standardServices, ...config.ultraServices];
  const image = kind === 'processor' ? config.processorImage : config.exportsImage;
  for (const serviceId of slots) await verifyRailwaySlot({ token, config, serviceId, image });
  console.log(`Verified Railway ${deployment} ${kind}: ${slots.length} bounded slots.`);
}

// ---- Whether Railway actually autodeploys main ----
// Railway only builds a push it receives through its GitHub app, for a trigger on this exact repository and branch.
// Nothing else deploys the slots, so when a link in that chain breaks the slots silently keep their old build (after
// the repository moved to revlinehq on 2026-11-05 Railway received no push at all). These checks name the broken link.

/** Railway answers this long after a push with at least a QUEUED or WAITING deployment of it. */
const PUSH_GRACE_MS = 3 * 60_000;
/** Longer than any build: a deployment still WAITING after this waits on a check that does not finish. */
const WAITING_LIMIT_MS = 20 * 60_000;
const IN_FLIGHT = ['QUEUED', 'WAITING', 'INITIALIZING', 'BUILDING', 'DEPLOYING', 'NEEDS_APPROVAL'];

const triggerSchema = z.object({ deploymentTriggers: z.object({ edges: z.array(z.object({ node: z.object({
  repository: z.string().nullable(), branch: z.string().nullable(), checkSuites: z.boolean().nullable(), provider: z.string().nullable(),
}) })) }) });
const buildSchema = z.object({ serviceInstance: z.object({ watchPatterns: z.array(z.string()).nullable(), rootDirectory: z.string().nullable(), railwayConfigFile: z.string().nullable() }) });
/** A read this token may not be allowed: null instead of failing the release. */
async function optionalRead(token, query, variables, schema) {
  try { return schema.parse(await railway({ token, query, variables })); }
  catch (error) { if (error instanceof RailwayRateLimitError) throw error; return null; }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let fetched = false;
/** Whether `commit` is `target` or a later commit of it. Fetches origin once for a commit this checkout lacks. */
function atOrAfter(target, commit) {
  if (!commit) return false;
  if (commit === target) return true;
  const check = () => { try { execFileSync('git', ['merge-base', '--is-ancestor', target, commit], { stdio: 'ignore' }); return true; } catch { return false; } };
  if (check() || fetched) return check();
  fetched = true;
  try { execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore' }); } catch { /* offline: unknown */ }
  return check();
}

/** The newest main commit Railway should have deployed: changelog commits ([skip ci]) are left out, so a check run
 *  right after a release does not wait on them. { commit, pushedAt } or null. */
export function latestDeployableMain(ref = 'origin/main') {
  try {
    const [commit, seconds] = git('log', '-1', '--format=%H %ct', '--fixed-strings', '--invert-grep', '--grep=[skip ci]', ref).split(' ');
    return commit ? { commit, pushedAt: Number(seconds) * 1000 } : null;
  } catch { return null; }
}

/** One slot's GitHub autodeploy, judged against `target` (a main commit and when it was pushed). `problems` mean main
 *  does not reach this slot without someone acting; `notes` are worth knowing but not broken (still building, a
 *  deliberate pinned-image rollback, a setting this token cannot read). */
export function autodeployProblems({ source, trigger, build, deployments, target, now = Date.now() }) {
  const problems = [], notes = [];
  if (source.kind === 'image') { notes.push(`runs a pinned registry image (a rollback stage), so it does not follow main until its source is set back to ${REPOSITORY}`); return { problems, notes }; }
  if (source.kind !== 'repository') problems.push('has no GitHub repository source');
  else if (source.repo?.toLowerCase() !== REPOSITORY.toLowerCase()) problems.push(isRevlineRepository(source.repo) ? `builds ${source.repo}, the repository's name before the transfer; Railway receives pushes for ${REPOSITORY} only` : `builds another repository (${source.repo})`);
  if (trigger === undefined) notes.push('deploy trigger not readable with this token');
  else if (!trigger) problems.push('has no GitHub deploy trigger in this environment (automatic deploys are off)');
  else {
    if (trigger.repository?.toLowerCase() !== REPOSITORY.toLowerCase()) problems.push(`deploy trigger watches ${trigger.repository ?? 'no repository'}, not ${REPOSITORY}`);
    if (trigger.branch !== 'main') problems.push(`deploy trigger watches branch ${trigger.branch ?? 'none'}, not main`);
    if (trigger.checkSuites) problems.push('has "Wait for CI" on, which production keeps off: a check suite that never completes (blacksmith-sh opens one on every main commit) holds the build forever');
  }
  if (build === undefined) notes.push('watch paths and root directory not readable with this token');
  if (build?.watchPatterns?.length) problems.push(`has watch paths (${build.watchPatterns.join(', ')}): commits outside them are not deployed`);
  if (build?.rootDirectory && !['', '/', '.'].includes(build.rootDirectory)) problems.push(`has root directory ${build.rootDirectory}; the Dockerfile builds from the repository root`);
  if (build?.railwayConfigFile) notes.push(`reads config-as-code from ${build.railwayConfigFile}`);
  if (!target) return { problems, notes };
  const short = target.commit.slice(0, 8);
  const ofTarget = deployments.filter(deployment => atOrAfter(target.commit, railwayDeploymentCommit(deployment)));
  const newest = ofTarget[0];
  if (!newest) {
    if (now - target.pushedAt < PUSH_GRACE_MS) notes.push(`no deployment of ${short} yet (pushed ${Math.round((now - target.pushedAt) / 1000)} s ago)`);
    else problems.push(`Railway never acted on main ${short}: no deployment of it or a later commit exists. Check that the Railway GitHub app is installed on the ${REPOSITORY.split('/')[0]} organization with access to ${REPOSITORY}, and the trigger and source above`);
  } else if (newest.status === 'SKIPPED' && !ofTarget.some(deployment => deployment.status !== 'SKIPPED')) problems.push(`Railway skipped ${short} (a failed check under "Wait for CI", or no change inside the watch paths)`);
  else if (newest.status === 'WAITING' && now - Date.parse(newest.createdAt ?? '') > WAITING_LIMIT_MS) problems.push(`${short} has waited for GitHub checks since ${newest.createdAt} ("Wait for CI")`);
  else if (newest.status === 'NEEDS_APPROVAL') problems.push(`${short} waits for approval in the Railway dashboard`);
  else if (IN_FLIGHT.includes(newest.status)) notes.push(`${short} is ${newest.status}`);
  return { problems, notes };
}

/** Every slot of `kind`, checked with autodeployProblems. Prints nothing: { problems, notes }, one line per finding.
 * @param {{ values: Record<string, string>, kind: 'processor' | 'exports', target: { commit: string, pushedAt: number } | null }} args */
export async function railwayAutodeployCheck({ values, kind, target }) {
  const config = railwayConfig(values.RAILWAY_WORKERS_JSON), token = values.RAILWAY_API_TOKEN;
  const lanes = kind === 'processor' ? [['processor', config.processorServices]] : [['standard', config.standardServices], ['ultra', config.ultraServices]];
  const found = { problems: [], notes: [] };
  for (const [lane, ids] of lanes) for (const serviceId of ids) {
    const instance = await railwayInstance({ token, config, serviceId });
    const triggers = await optionalRead(token, 'query($projectId: String!, $environmentId: String!, $serviceId: String!) { deploymentTriggers(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, first: 10) { edges { node { repository branch checkSuites provider } } } }',
      { projectId: config.projectId, environmentId: config.environmentId, serviceId }, triggerSchema);
    const build = await optionalRead(token, 'query($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { watchPatterns rootDirectory railwayConfigFile } }',
      { serviceId, environmentId: config.environmentId }, buildSchema);
    // A slot can list several triggers (one left from before the transfer): the one on this repository and main counts.
    const github = triggers?.deploymentTriggers.edges.map(edge => edge.node).filter(node => !node.provider || node.provider.toLowerCase() === 'github') ?? [];
    const trigger = triggers ? (github.find(node => node.repository?.toLowerCase() === REPOSITORY.toLowerCase() && node.branch === 'main') ?? github[0] ?? null) : undefined;
    const { problems, notes } = autodeployProblems({
      source: { kind: railwaySlotSource(instance), repo: instance.source?.repo ?? null }, trigger, build: build ? build.serviceInstance : undefined,
      deployments: await railwayDeployments({ token, config, serviceId, first: 20 }), target,
    });
    for (const note of notes) found.notes.push(`Railway ${lane} ${instance.serviceName}: ${note}.`);
    for (const problem of problems) found.problems.push(`Railway ${lane} ${instance.serviceName} (${serviceId}) ${problem}.`);
  }
  return found;
}
