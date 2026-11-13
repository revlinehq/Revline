import { railwayConfig, railwayInstance, railwayDeployments, railwayDeploymentCommit, railwayGoodDeployment, railwaySlotSource, verifyRailwayTarget, verifyRailwaySlot } from '../lib/railway-workers.mjs';

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
