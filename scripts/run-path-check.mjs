// Run-path gate. An assistant turn runs on the Cloudflare agent runner and reaches Convex through a bridge that
// only passes functions on an allowlist; where no runner is configured the same code runs inside Convex and every
// function is reachable. So a call that works in development can be refused in production. This reads the code a
// turn executes (everything convex/lib/editorTurn.ts and the runner Worker import) and fails when:
//   1. it calls a Convex function that is on neither the runner allowlist (TURN_FUNCTIONS in convex/agentRunnerHttp.ts)
//      nor the tool-write list (mutations in convex/toolWrites.ts);
//   2. a step forces a tool call on a Claude model (Sonnet 5.5 and Opus 5.5 answer it with a 400; Haiku 5.5 skips
//      thinking): tool choice is decided only by editorToolChoice in lib/ai/claude-model.ts;
//   3. a `finally` block awaits a Convex call without safely() (convex/lib/safely.ts): cleanup that throws hides
//      the result or the error of the work it follows.
//   4. anywhere in convex/, a database write spreads a variable into its row (`ctx.db.insert(table, { ...args })`)
//      without tableRow()/tablePatch() (convex/lib/exact.ts): TypeScript lets an extra field through and the table's
//      validator then throws at run time, which is how a failed turn crashed in its own cleanup on 2026-11-11.
// It parses source text; it runs nothing. Usage: node scripts/run-path-check.mjs [--json]. Exit 0 pass, 1 fail.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const ROOTS = ['convex/lib/editorTurn.ts', 'cf-workers/agent-runner/worker.ts'];
/** Calls these files make run inside Convex (from a mutation or an action there), never through the bridge. */
const CONVEX_SIDE = new Set(['convex/_generated/api.ts', 'convex/_generated/server.ts']);
const read = path => readFileSync(join(root, path), 'utf8');

/** A relative import resolved to a repository file, or null for a package or a missing file. */
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = join(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(join(root, candidate)) && /\.tsx?$/.test(candidate)) return relative(root, join(root, candidate));
  return null;
}

/** Every file the roots import, directly or through other files. Type-only imports are followed too: cheap, and never wrong. */
function closure() {
  const seen = new Set(), queue = [...ROOTS];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || CONVEX_SIDE.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)) {
      const target = resolveImport(file, match[1] ?? match[2]);
      if (target) queue.push(target);
    }
  }
  return [...seen].sort();
}

/** The quoted "module:function" names inside one array or Set literal that starts at `anchor`. */
function namesAfter(source, anchor, end) {
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`run-path-check: ${anchor} not found`);
  return new Set([...source.slice(start, source.indexOf(end, start)).matchAll(/'([\w/]+:\w+)'/g)].map(match => match[1]));
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const problems = [];
const files = closure();
const allowed = namesAfter(read('convex/agentRunnerHttp.ts'), 'const TURN_FUNCTIONS', 'const AGENT_FUNCTIONS');
const writes = namesAfter(read('convex/toolWrites.ts'), 'const mutations', 'const scope');

for (const file of files) {
  const source = read(file);
  // 1. Convex functions called through a context.
  const calls = [
    ...[...source.matchAll(/\.run(?:Query|Mutation|Action)\(\s*internal\.(\w+)\.(\w+)/g)].map(match => ({ name: `${match[1]}:${match[2]}`, index: match.index })),
    ...[...source.matchAll(/makeFunctionReference(?:<[^>]*>)?\(\s*['"]([\w/]+:\w+)['"]/g)].map(match => ({ name: match[1], index: match.index })),
  ];
  for (const call of calls) if (!allowed.has(call.name) && !writes.has(call.name))
    problems.push({ rule: 'runner-allowlist', file, line: lineOf(source, call.index), detail: `${call.name} is called by turn code but is not in TURN_FUNCTIONS (convex/agentRunnerHttp.ts) or the tool-write list (convex/toolWrites.ts). The runner's bridge refuses it in production. Add it to the list it belongs to.` });
  // 2. Forced tool choice.
  if (file !== 'lib/ai/claude-model.ts') for (const match of source.matchAll(/toolChoice\s*:\s*(?:['"]required['"]|\{\s*type\s*:\s*['"]tool['"])/g))
    problems.push({ rule: 'forced-tool-choice', file, line: lineOf(source, match.index), detail: 'A step forces a tool call. Claude Sonnet 5.5 and Opus 5.5 reject that with a 400. Use editorToolChoice(provider, mustCallTool) from lib/ai/claude-model.ts.' });
  // 3. Convex calls awaited in finally without safely().
  for (const match of source.matchAll(/\bfinally\s*\{/g)) {
    let depth = 1, index = match.index + match[0].length;
    for (; index < source.length && depth; index++) depth += source[index] === '{' ? 1 : source[index] === '}' ? -1 : 0;
    const body = source.slice(match.index + match[0].length, index - 1);
    for (const call of body.matchAll(/await\s+(?!safely\()[^;]*?\.run(?:Query|Mutation|Action)\(/g))
      problems.push({ rule: 'cleanup-can-throw', file, line: lineOf(source, match.index + match[0].length + call.index), detail: 'A finally block awaits a Convex call directly. If it throws it replaces the result or the error of the work before it. Wrap it: await safely(label, () => ctx.run…(…)).' });
  }
}

// 4. Rows built by spreading a variable. It fails in the modules a run writes through; elsewhere it is counted, so the
// number is visible and can only be driven down. `run-path-check: allow wide-row` on the line exempts a row whose
// keys are computed (and so cannot be typed), with the reason beside it.
const RUN_MODULES = /^convex\/(?:assistant\w*|agentRunner\w*|toolWrites|saveIncidents|incidents|lanes|aiCosts|compositionReview|referenceReads|clipping|mcp|briefs|memories)\.ts$|^convex\/lib\/(?:assistant_\w+|save_incidents|incidents|lane_evidence|toolSaveReceipts|publicationReceipt|project_data|revision_log)\.ts$/;
let wideElsewhere = 0;
const convexFiles = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === '_generated' ? [] : convexFiles(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
for (const file of convexFiles('convex')) {
  const source = read(file);
  for (const match of source.matchAll(/\bdb\.(?:insert|patch|replace)\(/g)) {
    // Walk the call's arguments; a spread counts only directly inside the row's own object literal.
    const stack = ['('];
    let index = match.index + match[0].length, row = -1, guarded = false;
    for (; index < source.length && stack.length; index++) {
      const char = source[index];
      if (char === '{' && stack.length === 1 && row < 0) { row = index; guarded = /table(?:Row|Patch)<[^>]*>\(\)\($/.test(source.slice(match.index, index)); }
      if ('({['.includes(char)) stack.push(char);
      else if (')}]'.includes(char)) stack.pop();
      else if (row >= 0 && !guarded && stack.at(-1) === '{' && stack.length === (source.slice(match.index, row).includes('(', match[0].length) ? 3 : 2) && source.startsWith('...', index) && /[A-Za-z_$]/.test(source[index + 3] ?? ''))
        if (!RUN_MODULES.test(file)) wideElsewhere++;
        else if (!source.split('\n')[lineOf(source, index) - 1].includes('run-path-check: allow wide-row')) problems.push({ rule: 'wide-row', file, line: lineOf(source, index), detail: 'A database write spreads a variable into its row. An extra field compiles and then fails the table validator at run time. Build the row with tableRow<Table>()({ … }) or tablePatch<Table>()({ … }) from convex/lib/exact.ts.' });
    }
  }
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ files: files.length, allowed: allowed.size, writes: writes.size, wideElsewhere, problems }, null, 2));
else {
  console.log(`Run-path check: ${files.length} files a turn executes, ${allowed.size} runner functions, ${writes.size} tool-write functions.`);
  if (wideElsewhere) console.log(`Note: ${wideElsewhere} database writes outside the run path still spread a variable into their row (not failing; wrap them with tableRow/tablePatch when touched).`);
  if (!problems.length) console.log('\nPASS: every Convex call a turn makes is allowlisted, no step forces a tool call, no cleanup can throw, no row is built from a wider object.');
  else { console.log(`\nFAIL: ${problems.length} problem${problems.length === 1 ? '' : 's'}.\n`); for (const problem of problems) console.log(`- [${problem.rule}] ${problem.file}:${problem.line}\n  ${problem.detail}`); }
}
process.exit(problems.length ? 1 : 0);
