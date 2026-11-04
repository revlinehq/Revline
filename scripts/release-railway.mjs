import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { command } from './release-command.mjs';
import { railwayConfig, verifyRailwayTarget, verifyRailwaySlot } from '../lib/railway-workers.mjs';

/** Release only a queue role that was explicitly migrated. Initial provisioning
 * and cutover remain operator commands, outside the main push workflow. */
export async function releaseRailway({ target, kind, values, env, dry }) {
  const config = railwayConfig(values.RAILWAY_WORKERS_JSON);
  if (config.convexUrl !== `https://${target.deployment}.convex.cloud`) throw new Error('Release Railway/Convex target mismatch.');
  if (dry) { console.log(`${target.name}: would build and runtime-preflight Railway ${kind}, drain slots, then stage the verified digest. Queue selection unchanged.`); return; }
  const directory = resolve('.data/railway-release');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${target.deployment}-${kind}.json`);
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const args = ['scripts/railway-workers.mjs', '--config', file, '--environment', config.environment, '--env-file', target.file, '--kind', kind, '--apply'];
  await command(process.execPath, [args[0], 'build', ...args.slice(1)], { env });
  await command(process.execPath, [args[0], 'stage', ...args.slice(1), ...(kind === 'processor' ? ['--image-first'] : [])], { env });
}

export async function verifyRailway({ deployment, kind, values }) {
  const config = railwayConfig(values.RAILWAY_WORKERS_JSON), token = values.RAILWAY_API_TOKEN;
  if (config.convexUrl !== `https://${deployment}.convex.cloud`) throw new Error('Verify Railway/Convex target mismatch.');
  await verifyRailwayTarget({ token, config });
  const slots = kind === 'processor' ? config.processorServices : [...config.standardServices, ...config.ultraServices];
  const image = kind === 'processor' ? config.processorImage : config.exportsImage;
  for (const serviceId of slots) await verifyRailwaySlot({ token, config, serviceId, image });
  console.log(`Verified Railway ${deployment} ${kind}: ${slots.length} bounded slots, staged image ${image}.`);
}
