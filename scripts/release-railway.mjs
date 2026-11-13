import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { command } from './release-command.mjs';
import { verifyStagingPromotion, stagingManifestFor } from './railway-promotion.mjs';
import { railwayConfig, verifyRailwayTarget, verifyRailwaySlot } from '../lib/railway-workers.mjs';

/** Release only a queue role that was explicitly migrated. Initial provisioning
 * and cutover remain operator commands, outside the main push workflow. */
/** `founderBypass` (a reason, from `release:prod --founder-bypass`) stages production without the staging job receipt
 *  for this one run. It still promotes only the image the `Railway staging` workflow built and runtime-checked for
 *  this exact commit, and scripts/railway-workers.mjs logs who, when and why before changing anything. */
export async function releaseRailway({ target, kind, values, env, dry, founderBypass }) {
  let config = railwayConfig(values.RAILWAY_WORKERS_JSON);
  if (config.convexUrl !== `https://${target.deployment}.convex.cloud`) throw new Error('Release Railway/Convex target mismatch.');
  if (dry) { console.log(`${target.name}: would check every Railway ${kind} setting first, runtime-check the staged digest, pause claims, drain, point the slots at it, verify the queue connection and resume claims (restoring the previous images on any failure). Queue selection unchanged.`); return; }
  const promotionArgs = [];
  if (config.environment === 'production') {
    const receiptFile = env.REVLINE_RAILWAY_STAGING_RECEIPT;
    const stagingEnvFile = env.REVLINE_RAILWAY_STAGING_ENV_FILE;
    if (founderBypass) {
      // No job evidence, but still the reviewed artifact: the digest CI built from this commit, read from its staging manifest.
      if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('A founder bypass still needs the exact release commit (GITHUB_SHA).');
      const { staging: staged } = await stagingManifestFor({ commit: env.GITHUB_SHA, env, file: env.REVLINE_RAILWAY_STAGING_MANIFEST });
      if (staged.distributedExports !== config.distributedExports) throw new Error('Staging and production differ in distributed-export mode; a bypass cannot change it.');
      config = railwayConfig({ ...config, [`${kind}Commit`]: staged[`${kind}Commit`], [`${kind}Image`]: staged[`${kind}Image`] });
      promotionArgs.push('--founder-bypass', founderBypass);
    } else {
      if (!receiptFile || !stagingEnvFile) throw new Error('Production release requires live staging job evidence before any Railway deployment.');
      const staged = railwayConfig(JSON.parse(await readFile(receiptFile, 'utf8')).config);
      const commit = kind === 'processor' ? staged.processorCommit : staged.exportsCommit;
      if (commit !== env.GITHUB_SHA) throw new Error('Staging must verify the exact main release commit.');
      config = railwayConfig({ ...config, [`${kind}Commit`]: commit, [`${kind}Image`]: staged[`${kind}Image`] });
      await verifyStagingPromotion({ config, receiptFile, stagingEnvFile, kinds: [kind] });
      promotionArgs.push('--staging-receipt', receiptFile, '--staging-env-file', stagingEnvFile);
    }
  }
  const directory = resolve('.data/railway-release');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${target.deployment}-${kind}.json`);
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const args = ['scripts/railway-workers.mjs', '--config', file, '--environment', config.environment, '--env-file', target.file, '--kind', kind, '--apply'];
  if (config.environment !== 'production') await command(process.execPath, [args[0], 'build', ...args.slice(1)], { env });
  await command(process.execPath, [args[0], 'stage', ...args.slice(1), ...(kind === 'processor' ? ['--image-first'] : []), ...promotionArgs], { env });
}

/** Read-only: every value and credential a production `stage` of `kind` needs, checked before the staging proof so a
 *  missing key stops the release while nothing has changed. It checks the digest staging built for this commit. */
export async function checkRailway({ target, kind, values, env }) {
  let config = railwayConfig(values.RAILWAY_WORKERS_JSON);
  if (config.convexUrl !== `https://${target.deployment}.convex.cloud`) throw new Error('Release Railway/Convex target mismatch.');
  if (config.environment === 'production') {
    const { staging } = await stagingManifestFor({ commit: env.GITHUB_SHA, env, file: env.REVLINE_RAILWAY_STAGING_MANIFEST });
    if (staging.distributedExports !== config.distributedExports) throw new Error('Staging and production differ in distributed-export mode; staging cannot promote to this production.');
    config = railwayConfig({ ...config, [`${kind}Commit`]: staging[`${kind}Commit`], [`${kind}Image`]: staging[`${kind}Image`] });
  }
  const directory = resolve('.data/railway-release');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${target.deployment}-${kind}-check.json`);
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await command(process.execPath, ['scripts/railway-workers.mjs', 'check', '--config', file, '--environment', config.environment, '--env-file', target.file, '--kind', kind], { env });
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
