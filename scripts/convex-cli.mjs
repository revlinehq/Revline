#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { assertIsolated, git, primary, root, readState } from './isolated-common.mjs';
import { isRevlineRepository } from '../lib/repository.mjs';

const args = process.argv.slice(2);
const pushes = ['dev', 'deploy'].includes(args[0]) || args[0] === 'run' && args.includes('--push');
try {
  const stagingCi = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_WORKFLOW === 'Railway staging' && isRevlineRepository(process.env.GITHUB_REPOSITORY) && process.env.GITHUB_SHA === git('rev-parse', 'HEAD') && git('rev-parse', '--git-dir') === '.git' && !readState() && process.env.CONVEX_DEPLOY_KEY?.startsWith('prod:striped-starling-234|') && !args.some(arg => /^(--prod|--deployment|--deployment-name|--env-file|--configure|--team|--project)(=|$)/.test(arg));
  if (pushes && !stagingCi && (root !== primary || git('branch', '--show-current') !== 'main')) {
    const state = assertIsolated();
    // Override flags can escape the scoped key or select another env file. Refuse them before invoking Convex.
    if (args.some(arg => /^(--prod|--deployment|--deployment-name|--preview-name|--preview-create|--url|--admin-key|--env-file|--configure|--team|--project)(=|$)/.test(arg))) throw new Error('Deployment overrides are disabled in agent worktrees. Use the scoped backend from npm run dev:isolated.');
    console.log(`target: dev (${state.name}, isolated worktree)`);
  }
  const child = spawn(process.execPath, [join(root, 'node_modules/convex/bin/main.js'), ...args], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) { console.error(`CONVEX GUARD: ${error.message}`); process.exitCode = 1; }
