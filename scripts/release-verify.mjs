import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { command, mask } from './release-command.mjs';

export const convexArgs = ['node_modules/convex/bin/main.js'];
export async function remoteEnv(deployment, env) {
  const values = parseEnv(await command(process.execPath, [...convexArgs, 'env', 'list', '--deployment', deployment], { env, quiet: true }));
  mask(values);
  return values;
}
export async function verifyConvex(deployment, env) {
  const { ConvexHttpClient } = await import('convex/browser');
  const { makeFunctionReference } = await import('convex/server');
  const values = await remoteEnv(deployment, env);
  const contract = await new ConvexHttpClient(`https://${deployment}.convex.cloud`).query(makeFunctionReference('mediaTasks:processorContract'), { workerSecret: values.RENDER_WORKER_SECRET });
  const version = Number(/MEDIA_PROCESSOR_VERSION\s*=\s*(\d+)/.exec(await readFile('lib/media-analysis/processor-version.ts', 'utf8'))?.[1]);
  if (contract.processorVersion !== version) throw new Error(`${deployment}: processor functions not ready for contract ${version}.`);
  console.log(`Verified Convex ${deployment}: functions ready, contract ${version}.`);
}
export async function verifyWorker(config, output, env) {
  const version = [...output.matchAll(/(?:Current Version ID|Version ID):\s*([\da-f-]{36})/gi)].at(-1)?.[1];
  if (!version) throw new Error(`${config}: Wrangler did not report the uploaded version.`);
  const deployments = JSON.parse(await command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'deployments', 'list', '--config', config, '--json'], { env, quiet: true }));
  const latest = deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (!latest?.versions.some(item => item.version_id === version && item.percentage === 100)) throw new Error(`${config}: uploaded Worker version is not serving 100% of traffic.`);
  console.log(`Verified Worker ${config}: ${version} serving 100%.`);
}
export async function verifyFrontend() {
  const id = (await readFile('dist/server/BUILD_ID', 'utf8')).trim();
  if (!id) throw new Error('Frontend build ID is empty.');
  for (const origin of ['https://tryrevline.com', 'https://editor.tryrevline.com']) {
    let ready = false;
    for (let attempt = 0; attempt < 18; attempt++) {
      const response = await fetch(`${origin}/?release=${encodeURIComponent(id)}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
      if (response.ok && (await response.text()).includes(id)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!ready) throw new Error(`${origin}: live HTML does not contain build ID ${id}.`);
    console.log(`Verified ${origin}: live HTML contains build ID ${id}.`);
  }
}
export async function verifyFly(deployment, kind, env) {
  const values = await remoteEnv(deployment, env);
  const image = values[kind === 'processor' ? 'FLY_PROCESSOR_IMAGE' : 'FLY_RENDER_IMAGE'];
  const app = `${kind === 'processor' ? 'revline-processor' : 'revline-render'}${deployment === 'different-gnu-398' ? '' : '-dev'}`;
  if (!image?.startsWith(`registry.fly.io/${app}@sha256:`)) throw new Error(`${app}: selected image targets the wrong app.`);
  // Existing tasks drain on their original image. Never stop an active export or
  // processor to make a release look complete; fail visibly if it cannot drain.
  const deadline = Date.now() + 50 * 60_000;
  while (true) {
    const machines = JSON.parse(await command('flyctl', ['machine', 'list', '-a', app, '--json'], { env, quiet: true }));
    const old = machines.filter(machine => !['destroyed', 'destroying'].includes(machine.state) && machine.config?.image !== image);
    for (const machine of old.filter(machine => ['stopped', 'failed'].includes(machine.state))) {
      await command('flyctl', ['machine', 'destroy', machine.id, '-a', app], { env });
    }
    const active = old.filter(machine => !['stopped', 'failed'].includes(machine.state));
    if (!active.length) { console.log(`Verified Fly ${app}: image ${image}; all remaining machines use it (scale-to-zero allowed).`); return; }
    if (Date.now() > deadline) throw new Error(`${app}: ${active.length} machines still use the previous image after draining.`);
    console.log(`Waiting for ${active.length} ${app} machines to finish on their previous image.`);
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
