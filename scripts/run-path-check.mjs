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
// It parses source text; it runs nothing. Known limits: rule 3 sees a Convex call awaited directly in a finally block,
// not one made inside a helper it calls; rule 4 sees a row written as an object literal in the call, not one built in a
// variable first; rules 1 to 3 follow static imports (relative and @/), not computed ones. Usage: node scripts/run-path-check.mjs [--json]. Exit 0 pass, 1 fail.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const ROOTS = ['convex/lib/editorTurn.ts', 'cf-workers/agent-runner/worker.ts'];
const read = path => readFileSync(join(root, path), 'utf8');

/** A relative import resolved to a repository file, or null for a package or a missing file. */
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/') ? specifier.slice(2) : join(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(join(root, candidate)) && /\.tsx?$/.test(candidate)) return relative(root, join(root, candidate));
  return null;
}

/** Every file the roots import, directly or through other files. Type-only imports are followed too: cheap, and never wrong. */
function closure() {
  const seen = new Set(), queue = [...ROOTS];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
      if (target) queue.push(target);
    }
  }
  return [...seen].sort();
}

/** The quoted "module:function" names inside one array or Set literal that starts at `anchor`. */
function namesAfter(source, anchor, end) {
  const start = source.indexOf(anchor), stop = source.indexOf(end, start);
  if (start < 0 || stop < 0) throw new Error(`run-path-check: could not find the list between "${anchor}" and "${end}". Update the anchors in scripts/run-path-check.mjs.`);
  const list = source.slice(start, stop).split('\n').map(line => line.replace(/^\s*\/\/.*$/, '')).join('\n');
  return new Set([...list.matchAll(/['"]([\w/]+:\w+)['"]/g)].map(match => match[1]));
}

/** The index just past the bracket that closes the one opening at `open`. */
function closing(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if ('({['.includes(source[index])) depth++;
    else if (')}]'.includes(source[index]) && !--depth) return index + 1;
  }
  return source.length;
}
const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const problems = [];
const files = closure();
const allowed = namesAfter(read('convex/agentRunnerHttp.ts'), 'const TURN_FUNCTIONS', 'const AGENT_FUNCTIONS');
const writes = namesAfter(read('convex/toolWrites.ts'), 'const mutations', 'const scope');

for (const file of files) {
  const source = read(file);
  // 1. Convex functions called through a context. The bridge passes only TURN_FUNCTIONS. A tool-write name is
  // reachable only through the toolkit's own `ctx`, which sends a saving tool's mutations to toolWrites:run.
  const calls = [
    ...[...source.matchAll(/(\w+)\.run(?:Query|Mutation|Action)\(\s*internal\.(\w+)\.(\w+)/g)].map(match => ({ receiver: match[1], name: `${match[2]}:${match[3]}`, index: match.index })),
    ...[...source.matchAll(/makeFunctionReference(?:<[^>]*>)?\(\s*['"]([\w/]+:\w+)['"]/g)].map(match => ({ receiver: '', name: match[1], index: match.index })),
  ];
  for (const call of calls) {
    if (allowed.has(call.name)) continue;
    const routed = writes.has(call.name) && file === 'convex/lib/editorToolkit.ts' && call.receiver === 'ctx';
    if (!routed) problems.push({ rule: 'runner-allowlist', file, line: lineOf(source, call.index), detail: `${call.name} is called by turn code but is not in TURN_FUNCTIONS (convex/agentRunnerHttp.ts)${writes.has(call.name) ? ', and a tool-write function is only reachable through the toolkit\'s own ctx inside a saving tool' : ' or the tool-write list (convex/toolWrites.ts)'}. The runner's bridge refuses it in production. Add it to the list it belongs to.` });
  }
  // 2. Forced tool choice: every toolChoice a step sets comes from editorToolChoice.
  if (file !== 'lib/ai/claude-model.ts') for (const match of source.matchAll(/\btoolChoice\b\s*(?::\s*(?!editorToolChoice\()|,|\})/g))
    problems.push({ rule: 'forced-tool-choice', file, line: lineOf(source, match.index), detail: 'A step sets toolChoice itself. Claude Sonnet 5.5 and Opus 5.5 reject a forced tool call with a 400 and Haiku 5.5 skips thinking. Write toolChoice: editorToolChoice(provider, mustCallTool) from lib/ai/claude-model.ts.' });
  cleanupRule(file, source);
}

/** 3. Convex calls awaited in finally without safely(). */
function cleanupRule(file, source) {
  for (const match of source.matchAll(/\bfinally\s*\{/g)) {
    let depth = 1, index = match.index + match[0].length;
    for (; index < source.length && depth; index++) depth += source[index] === '{' ? 1 : source[index] === '}' ? -1 : 0;
    const body = source.slice(match.index + match[0].length, index - 1);
    for (const call of body.matchAll(/await\s+(?!safely\()[^;]*?\.run(?:Query|Mutation|Action)\(/g)) {
      // A call with its own .catch() cannot throw out of the block.
      const statement = body.slice(call.index, closing(body, call.index + call[0].length - 1) + 12);
      if (/\)\s*\.catch\(/.test(statement)) continue;
      problems.push({ rule: 'cleanup-can-throw', file, line: lineOf(source, match.index + match[0].length + call.index), detail: 'A finally block awaits a Convex call directly. If it throws it replaces the result or the error of the work before it. Wrap it: await safely(label, () => ctx.run…(…)).' });
    }
  }
}
// The MCP action runs the same toolkit inside Convex and releases the project lock in a finally block.
cleanupRule('convex/mcpActions.ts', read('convex/mcpActions.ts'));

// 4. Rows built by spreading a variable. It fails in the modules a run writes through (every module on the two lists,
// plus the helpers they write with); elsewhere it is counted, so the number is visible and can only be driven down.
// `run-path-check: allow wide-row` on the line exempts a row whose keys are computed (and so cannot be typed).
const listed = new Set([...allowed, ...writes].map(name => `convex/${name.split(':')[0]}.ts`));
const RUN_HELPERS = /^convex\/lib\/(?:assistant_\w+|save_incidents|incidents|lane_evidence|toolSaveReceipts|publicationReceipt|project_data|revision_log|media_queue|reference_reads)\.ts$/;
const runModule = file => listed.has(file) || RUN_HELPERS.test(file) || /^convex\/(?:assistant\w*|agentRunner\w*|toolWrites|saveIncidents|incidents)\.ts$/.test(file);
let wideElsewhere = 0;
const convexFiles = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === '_generated' ? [] : convexFiles(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
for (const file of convexFiles('convex')) {
  const source = read(file);
  for (const match of source.matchAll(/\bdb\.(?:insert|patch|replace)\(/g)) {
    const open = match.index + match[0].length - 1, end = closing(source, open);
    // The row is the last argument: everything after the first top-level comma.
    let depth = 0, comma = -1;
    for (let index = open; index < end && comma < 0; index++) {
      if ('({['.includes(source[index])) depth++;
      else if (')}]'.includes(source[index])) depth--;
      else if (source[index] === ',' && depth === 1) comma = index;
    }
    if (comma < 0) continue;
    const row = source.slice(comma + 1, end - 1).trim();
    if (/^table(?:Row|Patch)</.test(row)) continue;
    // An object literal, or any other call wrapped around one: look at the first literal for a spread of a name.
    const brace = row.indexOf('{');
    if (brace < 0 || (!row.startsWith('{') && !/^[\w.$]+\(/.test(row))) continue;
    const literal = row.slice(brace, closing(row, brace));
    let level = 0, wide = false;
    for (let index = 0; index < literal.length && !wide; index++) {
      if ('({['.includes(literal[index])) level++;
      else if (')}]'.includes(literal[index])) level--;
      else if (level === 1 && literal.startsWith('...', index) && /[A-Za-z_$]/.test(literal[index + 3] ?? '')) wide = true;
    }
    if (!wide) continue;
    const line = lineOf(source, match.index);
    if (!runModule(file)) wideElsewhere++;
    else if (!source.split('\n')[line - 1].includes('run-path-check: allow wide-row')) problems.push({ rule: 'wide-row', file, line, detail: 'A database write spreads a variable into its row. An extra field compiles and then fails the table validator at run time. Build the row with tableRow<Table>()({ … }) or tablePatch<Table>()({ … }) from convex/lib/exact.ts.' });
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
