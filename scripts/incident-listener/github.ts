import { incidentText } from '../../lib/incidents';
import { githubToken, run } from './shared';

// T3 owns the agent environment. Supply the cached credential only to GitHub
// commands, including on a reboot before the desktop keyring is unlocked.
const [operation, ...args] = process.argv.slice(2);
if (!['pr', 'fetch', 'push'].includes(operation)) throw new Error('Usage: github.ts pr <gh pr arguments> | fetch <refs> | push <incident-branch>');
if (operation === 'pr' && !['list', 'view', 'create', 'edit', 'checks', 'diff', 'status'].includes(args[0])) throw new Error('Expected a draft PR creation, edit or inspection command');
if (operation === 'push' && (args.length !== 1 || !/^incident\/[a-z0-9-]+$/.test(args[0]))) throw new Error('Only one incident branch may be pushed');
if (operation === 'fetch' && args.some(ref => !/^[\w/-]+$/.test(ref))) throw new Error('Expected branch references');
try {
  const auth = ['-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
  const command = operation === 'pr' ? 'gh' : 'git';
  const commandArgs = operation === 'pr' ? ['pr', ...args] : operation === 'fetch' ? [...auth, 'fetch', 'origin', ...args] : [...auth, 'push', 'origin', `HEAD:refs/heads/${args[0]}`];
  const result = await run(command, commandArgs, { env: { ...process.env, GH_TOKEN: await githubToken() }, timeout: 180_000, maxBuffer: 4_000_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  console.error(incidentText(error instanceof Error ? error.message : 'GitHub operation failed', 2000));
  process.exitCode = 1;
}
