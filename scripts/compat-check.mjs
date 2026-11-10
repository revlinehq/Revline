// Cross-version compatibility gate. Convex, the iOS app and the media processor are released separately, so a
// change that is fine in one checkout can break the version already installed or deployed. This compares the
// real validators of two revisions (the Convex modules are bundled and loaded, nothing is parsed by hand) and fails when:
//   1. a public Convex function the iOS app calls (the "module:function" strings in mobile/) changes its
//      arguments or return value in a way an installed build cannot handle;
//   2. a media-processor read mode or task kind is added without a gated entry in
//      lib/server/processor-capabilities.ts and a caller guarded by processorCan;
//   3. convex/schema.ts removes or changes a table, index or field (additive changes pass).
// An intentional break needs a fresh line in mobile/CONTRACT_CHANGES.md, added in the same range.
// Usage: node scripts/compat-check.mjs [--base <rev>] [--head <rev>|WORKTREE] [--json]
//   head defaults to HEAD, base to merge-base(origin/main, head). Exit 0 pass, 1 incompatible, 2 usage/internal error.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const OVERRIDES = 'mobile/CONTRACT_CHANGES.md';
const MANIFEST = 'lib/server/processor-capabilities.ts';
const CALL_SITE = '"[A-Za-z][A-Za-z0-9_]*(/[A-Za-z0-9_]+)*:[A-Za-z_][A-Za-z0-9_]*"';
const WORKTREE = 'WORKTREE';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitOr = (fallback, ...args) => { try { return git(...args); } catch { return fallback; } };

// ── Reading one revision ────────────────────────────────────────────────────────────────────────────────────

/** File text at a revision, or '' when it does not exist there. */
const fileAt = (rev, path) => rev === WORKTREE ? (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '') : gitOr('', 'show', `${rev}:${path}`);

/** The "module:function" strings the iOS app calls at a revision. */
function callSites(rev) {
  const args = ['grep', '-I', '-h', '-o', '-E', CALL_SITE, ...(rev === WORKTREE ? ['--untracked'] : [rev]), '--', 'mobile'];
  return [...new Set(gitOr('', ...args).split('\n').filter(Boolean).map(text => text.slice(1, -1)))];
}

/** The source tree of a revision (the checkout itself for WORKTREE) and a private directory for its bundles. */
function snapshot(rev, temp) {
  const out = mkdtempSync(join(temp, 'out-'));
  symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'));
  if (rev === WORKTREE) return { rev, source: root, out };
  const source = mkdtempSync(join(temp, 'src-'));
  const present = git('ls-tree', '--name-only', rev).split('\n');
  const paths = ['convex', 'lib', 'package.json', 'tsconfig.json', 'convex.json'].filter(path => present.includes(path));
  if (!paths.includes('convex')) throw new Error(`${rev} has no convex/ directory.`);
  execFileSync('bash', ['-c', 'set -o pipefail; git archive "$1" -- "${@:3}" | tar -x -C "$2"', 'bash', rev, source, ...paths], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  return { rev, source, out };
}

const require = createRequire(join(root, 'package.json'));
/** Packages stay external, as before. A package one revision imports and the checkout no longer installs (a pull
 *  request that removes a dependency) loads as an inert stub: only validators are read, never package code. */
const installedPackages = { name: 'installed-packages', setup(build) {
  build.onResolve({ filter: /^[^./]/ }, args => {
    // Path aliases (@/lib/...) and Node built-ins resolve as usual.
    if (args.kind === 'entry-point' || /^(@\/|node:)/.test(args.path)) return undefined;
    try { require.resolve(args.path); return undefined; }
    catch (error) { return error.code === 'MODULE_NOT_FOUND' ? { path: args.path, namespace: 'missing-package' } : undefined; }
  });
  build.onLoad({ filter: /.*/, namespace: 'missing-package' }, () => ({ loader: 'js', contents: 'const stub = new Proxy(function () {}, { get: (_, key) => key === "__esModule" ? false : stub, apply: () => stub, construct: () => stub }); module.exports = stub;' }));
} };

/** Bundles the named modules of a snapshot and loads them. A module absent at that revision loads as null. */
async function load(snap, files) {
  const { build } = await import('esbuild');
  const present = files.filter(file => existsSync(join(snap.source, file)));
  if (present.length) {
    try {
      await build({ absWorkingDir: snap.source, entryPoints: present, outbase: snap.source, outdir: snap.out, bundle: true, format: 'esm', platform: 'node',
        packages: 'external', plugins: [installedPackages], logLevel: 'silent', outExtension: { '.js': '.mjs' }, loader: { '.node': 'empty' } });
    } catch (error) { throw new Error(`Could not bundle the Convex modules of ${snap.rev}: ${error.errors?.[0]?.text ?? error.message}`); }
  }
  const modules = {};
  // A module may print while loading; keep stdout for the report (and for --json).
  const { log, info } = console;
  console.log = console.info = console.error;
  try {
  for (const file of files) {
    if (!present.includes(file)) { modules[file] = null; continue; }
    try { modules[file] = await import(pathToFileURL(join(snap.out, file.replace(/\.tsx?$/, '.mjs'))).href); }
    catch (error) { throw new Error(`Could not load ${file} of ${snap.rev}: ${error.message}`); }
  }
  } finally { console.log = log; console.info = info; }
  return modules;
}

// ── Comparing validators ────────────────────────────────────────────────────────────────────────────────────

function short(validator) {
  const text = (() => {
    switch (validator?.type) {
      case 'object': return `{ ${Object.entries(validator.value).map(([name, field]) => `${name}${field.optional ? '?' : ''}`).join(', ')} }`;
      case 'array': return `array of ${short(validator.value)}`;
      case 'union': return validator.value.map(short).join(' | ');
      case 'literal': return JSON.stringify(validator.value);
      case 'id': return `id(${validator.tableName})`;
      case 'record': return `record<${short(validator.keys)}, ${short(validator.values?.fieldType ?? validator.values)}>`;
      default: return validator?.type ?? 'nothing';
    }
  })();
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}
const literalKind = value => typeof value === 'bigint' ? 'bigint' : typeof value === 'number' ? 'number' : typeof value;

/** Why a value valid under `from` might not be valid under `to` (empty: every such value is valid).
 *  `flip` says `from` is the head side (return values: an installed app decodes what head sends with the base
 *  shape, and ignores fields it does not know). Messages always read base → head. */
function gaps(from, to, path, flip) {
  const say = (what) => [{ path: path || '(value)', what }];
  const change = () => say(`${short(flip ? to : from)} → ${short(flip ? from : to)}`);
  if (to.type === 'any') return [];
  if (from.type === 'union') {
    const found = from.value.flatMap(member => gaps(member, to, path, flip));
    return found.filter((gap, index) => found.findIndex(other => other.path === gap.path && other.what === gap.what) === index);
  }
  if (to.type === 'union') {
    const each = to.value.map(member => gaps(from, member, path, flip));
    if (each.some(found => !found.length)) return [];
    const alike = to.value.map((member, index) => ({ member, found: each[index] })).filter(({ member }) => member.type === from.type && from.type !== 'literal');
    if (alike.length === 1) return alike[0].found;
    return say(flip ? `the new value ${short(from)} is not one the installed app knows (${short(to)})` : `${short(from)} is no longer accepted (now ${short(to)})`);
  }
  if (from.type === 'literal') {
    if (to.type === 'literal') return Object.is(from.value, to.value) ? [] : change();
    return to.type === literalKind(from.value) || (to.type === 'float64' && typeof from.value === 'number') ? [] : change();
  }
  if (from.type !== to.type) return change();
  switch (from.type) {
    case 'id': return from.tableName === to.tableName ? [] : change();
    case 'array': return gaps(from.value, to.value, `${path}[]`, flip);
    case 'record': return [...gaps(from.keys, to.keys, `${path}{key}`, flip), ...gaps(from.values?.fieldType ?? from.values, to.values?.fieldType ?? to.values, `${path}{value}`, flip)];
    case 'object': {
      const found = [], at = name => path ? `${path}.${name}` : name;
      for (const [name, field] of Object.entries(from.value)) {
        const other = to.value[name];
        if (!other) { if (!flip) found.push({ path: at(name), what: 'removed' }); continue; }
        if (field.optional && !other.optional) found.push({ path: at(name), what: flip ? 'required → optional (the installed app expects it every time)' : 'optional → required' });
        found.push(...gaps(field.fieldType, other.fieldType, at(name), flip));
      }
      for (const [name, other] of Object.entries(to.value)) if (!from.value[name] && !other.optional) found.push({ path: at(name), what: flip ? 'removed' : 'new required field' });
      return found;
    }
    default: return [];
  }
}

const literals = validator => !validator ? [] : validator.type === 'literal' ? [validator.value] : validator.type === 'union' ? validator.value.flatMap(literals) : [];

// ── The three rules ─────────────────────────────────────────────────────────────────────────────────────────

const moduleFile = name => `convex/${name.split(':')[0]}.ts`;
const OVERRIDE_HINT = `if the break is intended, add a reviewed line to ${OVERRIDES} in this pull request: - \`<item>\`: <reason>`;

function mobileContract(sites, base, head, baseModules, headModules, notes) {
  const failures = [];
  for (const site of sites.all) {
    const [, name] = site.split(':'), file = moduleFile(site);
    const publicFunction = modules => { const fn = modules[file]?.[name]; return fn && typeof fn.exportArgs === 'function' && fn.isPublic ? fn : null; };
    const before = publicFunction(baseModules), after = publicFunction(headModules);
    if (!before && !after) { if (baseModules[file] || headModules[file]) notes.push(`${site}: called from mobile/ but not a public Convex function at either revision.`); continue; }
    if (!before) continue; // new function: nothing installed depends on it yet
    const fix = `Keep ${site} as it is and add a new function name for the new shape (as projects:listPage did for projects:list); or, ${OVERRIDE_HINT.replace('<item>', site)}`;
    if (!after) { failures.push({ rule: 'ios-contract', item: site, problems: [{ path: site, what: 'the function was removed or is no longer public' }], fix }); continue; }
    const problems = [];
    const beforeArgs = JSON.parse(before.exportArgs()), afterArgs = JSON.parse(after.exportArgs());
    problems.push(...gaps(beforeArgs, afterArgs, '', false).map(gap => ({ path: `args${gap.path === '(value)' ? '' : `.${gap.path}`}`, what: gap.what })));
    const beforeReturns = JSON.parse(before.exportReturns()), afterReturns = JSON.parse(after.exportReturns());
    if (!beforeReturns || beforeReturns.type === 'any') notes.push(`${site}: no returns validator at ${base}, so its return shape cannot be compared.`);
    else if (!afterReturns || afterReturns.type === 'any') problems.push({ path: 'returns', what: `${short(beforeReturns)} → no returns validator (the shape is no longer checked)` });
    else problems.push(...gaps(afterReturns, beforeReturns, '', true).map(gap => ({ path: `returns${gap.path === '(value)' ? '' : gap.path.startsWith('[') ? gap.path : `.${gap.path}`}`, what: gap.what })));
    if (problems.length) failures.push({ rule: 'ios-contract', item: site, problems, fix });
  }
  return failures;
}

async function processorCapabilities(baseModules, headModules, headSnap) {
  const members = (modules, name) => literals(modules['convex/schema.ts']?.[name]?.json).map(String);
  const added = [
    ...members(headModules, 'referenceReadMode').filter(mode => !members(baseModules, 'referenceReadMode').includes(mode)).map(mode => ({ id: `read:${mode}`, name: mode, what: 'read mode', list: 'GATED_READ_MODES' })),
    ...members(headModules, 'mediaTaskKind').filter(kind => !members(baseModules, 'mediaTaskKind').includes(kind)).map(kind => ({ id: `kind:${kind}`, name: kind, what: 'task kind', list: 'GATED_TASK_KINDS' })),
  ];
  if (!added.length) return [];
  const manifest = (await load(headSnap, [MANIFEST]))[MANIFEST];
  const sources = [];
  const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) { if (entry.name === '_generated' || entry.name === 'node_modules') continue; const path = join(directory, entry.name); if (entry.isDirectory()) walk(path); else if (/\.tsx?$/.test(entry.name)) sources.push(readFileSync(path, 'utf8')); } };
  walk(join(headSnap.source, 'convex'));
  return added.flatMap(({ id, name, what, list }) => {
    const problems = [];
    if (!manifest) problems.push({ path: MANIFEST, what: 'the capability manifest does not exist at this revision' });
    else if (!(manifest[list] ?? []).includes(name)) problems.push({ path: `${MANIFEST} ${list}`, what: `'${name}' is not listed as gated` });
    const guarded = new RegExp(`processorCan\\(\\s*[^,()]+,\\s*['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
    if (!sources.some(source => guarded.test(source))) problems.push({ path: 'convex/', what: `no caller checks processorCan(ctx, '${id}') before depending on it` });
    return problems.length ? [{ rule: 'processor-capability', item: `capability:${id}`, problems: [{ path: 'convex/schema.ts', what: `new media-processor ${what} '${name}': the processor already deployed does not have it and answers with an empty success` }, ...problems],
      fix: `Add '${name}' to ${list} in ${MANIFEST}, and in the Convex code that queues it call \`if (!await processorCan(ctx, '${id}'))\` and degrade (warn, skip or fall back) instead of queuing; or, ${OVERRIDE_HINT.replace('<item>', `capability:${id}`)}` }] : [];
  });
}

function schemaChanges(baseModules, headModules) {
  const tables = modules => { const schema = modules['convex/schema.ts']?.default; return schema?.export ? JSON.parse(schema.export()).tables : null; };
  const before = tables(baseModules), after = tables(headModules);
  if (!before || !after) return [];
  const failures = [];
  const fail = (item, path, what, fix) => { const existing = failures.find(failure => failure.item === item); if (existing) existing.problems.push({ path, what }); else failures.push({ rule: 'schema', item, problems: [{ path, what }], fix: `${fix}; or, ${OVERRIDE_HINT.replace('<item>', item)}` }); };
  for (const table of before) {
    const name = table.tableName, next = after.find(other => other.tableName === name);
    if (!next) { fail(`schema:${name}`, name, 'table removed', 'Keep the table until no deployed code reads it and its rows are migrated'); continue; }
    for (const kind of ['indexes', 'searchIndexes', 'vectorIndexes']) for (const index of table[kind] ?? []) {
      const other = (next[kind] ?? []).find(candidate => candidate.indexDescriptor === index.indexDescriptor);
      const fields = value => JSON.stringify({ ...value, indexDescriptor: undefined });
      if (!other) fail(`schema:${name}.${index.indexDescriptor}`, `${name}.${index.indexDescriptor}`, 'index removed (functions still deployed query it, and a rollback needs it)', 'Keep the index; remove it in a later release once nothing deployed uses it');
      else if (fields(other) !== fields(index)) fail(`schema:${name}.${index.indexDescriptor}`, `${name}.${index.indexDescriptor}`, `index changed: ${JSON.stringify(index.fields ?? index)} → ${JSON.stringify(other.fields ?? other)}`, 'Add a new index under a new name and keep this one');
    }
    for (const gap of gaps(table.documentType, next.documentType, '', false)) {
      const field = gap.path === '(value)' ? '' : gap.path.split(/[.[{]/)[0];
      fail(field ? `schema:${name}.${field}` : `schema:${name}`, `${name}${field ? `.${gap.path}` : ''}`, gap.what, 'Make the change additive: a new optional field (or a widened union) that existing rows already satisfy');
    }
  }
  return failures;
}

/** Override lines added to mobile/CONTRACT_CHANGES.md within the range: item → reason. */
function addedOverrides(base, head) {
  // Lines inside a code fence are the format examples, never entries.
  const lines = text => { let fenced = false; return text.split('\n').map(line => line.trim()).filter(line => { if (line.startsWith('```')) { fenced = !fenced; return false; } return line && !fenced; }); };
  const before = new Set(lines(fileAt(base, OVERRIDES)));
  const found = new Map();
  for (const line of lines(fileAt(head, OVERRIDES))) {
    if (before.has(line)) continue;
    const match = /^[-*]\s+`([^`]+)`\s*[:—–-]?\s*(.*)$/.exec(line);
    if (match && /[A-Za-z0-9]{3}/.test(match[2]) && !match[2].startsWith('<')) found.set(match[1], match[2]);
  }
  return found;
}

/** Compares two revisions. `head` may be 'WORKTREE' for the uncommitted checkout. */
export async function compatCheck({ base, head = 'HEAD' } = {}) {
  const headCommit = head === WORKTREE ? 'HEAD' : head;
  git('rev-parse', '--verify', '--quiet', `${headCommit}^{commit}`);
  if (!base) {
    if (!gitOr('', 'rev-parse', '--verify', '--quiet', 'origin/main^{commit}').trim()) throw new Error('origin/main is not available here; fetch it or pass --base <rev>.');
    base = git('merge-base', 'origin/main', headCommit).trim();
  }
  git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  const temp = mkdtempSync(join(tmpdir(), 'revline-compat-'));
  try {
    const sites = { base: callSites(base), head: callSites(head) };
    sites.all = [...new Set([...sites.base, ...sites.head])].sort();
    const files = ['convex/schema.ts', ...new Set(sites.all.map(moduleFile))];
    const baseSnap = snapshot(base, temp), headSnap = snapshot(head, temp);
    const baseModules = await load(baseSnap, files), headModules = await load(headSnap, files);
    const notes = [];
    const found = [...mobileContract(sites, base, head, baseModules, headModules, notes), ...await processorCapabilities(baseModules, headModules, headSnap), ...schemaChanges(baseModules, headModules)];
    const overrides = addedOverrides(base, head);
    const reasonFor = item => overrides.get(item) ?? (item.startsWith('schema:') ? overrides.get(item.split('.')[0]) : undefined);
    const failures = found.filter(failure => !reasonFor(failure.item));
    const allowed = found.filter(failure => reasonFor(failure.item)).map(failure => ({ ...failure, reason: reasonFor(failure.item) }));
    return { ok: !failures.length, base, head, checked: { functions: sites.all.length, tables: (headModules['convex/schema.ts']?.default?.export ? JSON.parse(headModules['convex/schema.ts'].default.export()).tables.length : 0) }, failures, allowed, notes };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

const RULES = { 'ios-contract': 'iOS contract', 'processor-capability': 'Processor capability', schema: 'Schema' };
export function compatReport(result) {
  const lines = [`Compatibility check: ${result.base.slice(0, 12)} → ${result.head.slice(0, 12)} (${result.checked.functions} functions called from mobile/, ${result.checked.tables} tables).`];
  for (const note of result.notes) lines.push(`note: ${note}`);
  for (const item of result.allowed) lines.push(`allowed by override: ${item.item} (${item.reason})`, ...item.problems.map(problem => `    ${problem.path}: ${problem.what}`));
  for (const failure of result.failures) lines.push('', `FAIL ${RULES[failure.rule]}: ${failure.item}`, ...failure.problems.map(problem => `    ${problem.path}: ${problem.what}`), `  Fix: ${failure.fix}`);
  lines.push('', result.ok ? `PASS: nothing incompatible with the installed iOS app, the deployed media processor or stored data${result.allowed.length ? ` (${result.allowed.length} allowed by override)` : ''}.`
    : `FAIL: ${result.failures.length} incompatible change${result.failures.length === 1 ? '' : 's'} (${result.failures.map(failure => failure.item).join(', ')}).`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let code = 2;
  try {
    const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string', default: 'HEAD' }, json: { type: 'boolean', default: false } } });
    const result = await compatCheck({ base: values.base, head: values.head });
    console.log(values.json ? JSON.stringify(result, null, 2) : compatReport(result));
    code = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`compat-check could not run: ${error.message}\nUsage: node scripts/compat-check.mjs [--base <rev>] [--head <rev>|WORKTREE] [--json]`);
  }
  // Loaded Convex modules may hold handles open; the result is already printed.
  process.exit(code);
}
