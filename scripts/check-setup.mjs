// Compare the dev and production Convex deployments' configuration and flag mismatches.
// Usage: npm run check:setup. Secrets are reported only as set or missing.
import { execFileSync } from 'node:child_process';

const read = prod => {
  const env = { ...process.env }; delete env.CONVEX_DEPLOY_KEY;
  const out = execFileSync('npx', ['convex', 'run', 'deploymentSetup:report', '{}', ...(prod ? ['--prod'] : [])], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{')));
};
const dev = read(false), prod = read(true), problems = [];
const expect = (ok, message) => { if (!ok) problems.push(message); };

expect(prod.stripeMode === 'live', `production Stripe key is ${prod.stripeMode}, expected live`);
expect(dev.stripeMode === 'test', `dev Stripe key is ${dev.stripeMode}, expected test`);
expect(prod.values.APP_ORIGIN === 'https://tryrevline.com', `production APP_ORIGIN is ${prod.values.APP_ORIGIN}`);
expect(prod.values.MCP_PUBLIC_ORIGIN === 'https://tryrevline.com', `production MCP_PUBLIC_ORIGIN is ${prod.values.MCP_PUBLIC_ORIGIN}`);
expect(!prod.site.includes(dev.site.split('//')[1]?.split('.')[0] ?? '#'), 'production points at the dev deployment');
for (const [name, setup] of [['dev', dev], ['production', prod]]) {
  if (setup.values.RENDER_PROVIDER === 'railway') {
    for (const key of ['RAILWAY_API_TOKEN', 'MEDIA_WORKER_SECRET_EXPORTS']) expect(setup.secrets[key], `${name}: exports run on Railway but ${key} is missing`);
  }
  expect(!setup.secrets.RENDER_WORKER_SECRET_PREVIOUS, `${name}: RENDER_WORKER_SECRET_PREVIOUS is still set; unset it once processor containers have restarted`);
}
// A secret set on one deployment but not the other usually means a step was missed. Dev runs the
// local worker instead of the Cloudflare processor, and alerts and the Clerk webhook are production-only.
const PRODUCTION_ONLY = new Set(['RENDER_WORKER_SECRET_PREVIOUS', 'MEDIA_PROCESSOR_WAKE_URL', 'RAILWAY_API_TOKEN', 'MEDIA_WORKER_SECRET_EXPORTS', 'DISCORD_WEBHOOK_URL', 'CLERK_WEBHOOK_SIGNING_SECRET']);
for (const key of Object.keys(prod.secrets)) if (!PRODUCTION_ONLY.has(key) && dev.secrets[key] !== prod.secrets[key]) problems.push(`${key} is ${prod.secrets[key] ? 'set' : 'missing'} on production but ${dev.secrets[key] ? 'set' : 'missing'} on dev`);

const rows = [['setting', 'dev', 'production'], ['site', dev.site, prod.site], ['stripe', dev.stripeMode, prod.stripeMode],
  ...Object.keys(prod.values).map(key => [key, String(dev.values[key] ?? '-'), String(prod.values[key] ?? '-')]),
  ...Object.keys(prod.secrets).map(key => [key, dev.secrets[key] ? 'set' : '-', prod.secrets[key] ? 'set' : '-'])];
const width = [0, 1, 2].map(column => Math.min(48, Math.max(...rows.map(row => row[column].length))));
for (const row of rows) console.log(row.map((cell, column) => cell.slice(0, 48).padEnd(width[column])).join('  '));
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.map(problem => `- ${problem}`).join('\n')}` : '\nNo problems found.');
process.exitCode = problems.length ? 1 : 0;
