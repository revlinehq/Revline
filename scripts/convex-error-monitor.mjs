/** Local, read-only Convex log capture. Raw events and credentials are never persisted. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = process.env.REVLINE_MONITOR_DIR || join(homedir(), '.local/state/revline-monitor');
const DEPLOYMENTS = ['majestic-alpaca-541', 'different-gnu-398'];
const MAX_EVENTS = 500;
const MAX_SEEN = 10_000;
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

export function redactError(value, secrets = []) {
  let result = String(value ?? 'Unknown function error');
  for (const secret of secrets) if (secret.length >= 8) result = result.split(secret).join('[redacted]');
  // Validator object dumps may include complete prompts, media URLs, and user data.
  result = result.replace(/(?:^|\n|\s)(?:Object|Value|Arguments|Args|Validator):\s*[\s\S]*/i, ' [payload omitted]');
  result = result
    .replace(/https?:\/\/[^\s<>"')]+/gi, '[url omitted]')
    .replace(/\b(?:sk[-_](?:live|test|ant)[-_]?[\w-]*|sk-ant-[\w-]+|tlk_[\w-]+|gh[pousr]_[\w]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[credential redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email omitted]');
  // Keep the diagnostic headline and source stack only, not arbitrary multiline payloads.
  const lines = result.split('\n');
  return [lines[0], ...lines.slice(1).filter(line => /^\s*at\s/.test(line))].join('\n').slice(0, 1800);
}

export function failureEvents(deployment, event, secrets = []) {
  if (!event || typeof event !== 'object') return [];
  const messages = [];
  // A failed function can have no console output at all.
  if (typeof event.error === 'string' && event.error) messages.push(event.error);
  // Do not persist console payloads: report the occurrence and inspect on demand.
  if (Array.isArray(event.logLines) && event.logLines.some(line =>
    typeof line === 'object' && line?.level === 'ERROR' || typeof line === 'string' && /^\[ERROR\]/.test(line))) {
    messages.push('Function emitted console.error; payload omitted from monitoring storage.');
  }
  return messages.map(message => {
    const error = redactError(message, secrets);
    return {
      id: hash(`${deployment}:${event.executionId || event.requestId || event.timestamp}:${error}`),
      deployment,
      function: String(event.identifier || 'unknown').slice(0, 160),
      requestId: typeof event.requestId === 'string' ? event.requestId.slice(0, 100) : undefined,
      timestamp: Number.isFinite(event.timestamp) ? event.timestamp * 1000 : Date.now(),
      error,
    };
  });
}

export function appendEvents(state, events) {
  const seen = new Set(state.seen || []);
  let added = 0;
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    state.events.push(event);
    added++;
  }
  state.seen = [...seen].slice(-MAX_SEEN);
  const dropped = Math.max(0, state.events.length - MAX_EVENTS);
  state.discardedEvents = (state.discardedEvents || 0) + dropped;
  state.events = state.events.slice(-MAX_EVENTS);
  return added;
}

function readJson(name, fallback) {
  try { return JSON.parse(readFileSync(join(STATE_DIR, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function writeJson(name, value) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const target = join(STATE_DIR, name);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, target);
}

function alive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function knownSecrets() {
  const secrets = [];
  for (const file of ['.env.local', '.env.production.local']) {
    let content;
    try { content = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && /KEY|SECRET|TOKEN|PASSWORD/.test(match[1])) secrets.push(match[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return secrets;
}

export function monitorHealth(state, running, now = Date.now()) {
  const warnings = [];
  if (!running) warnings.push('The local capture process is not running or is outside this process namespace.');
  if (!state.updatedAt || now - state.updatedAt > 90_000) warnings.push('The capture heartbeat is stale.');
  for (const deployment of DEPLOYMENTS) {
    const status = state.deployments?.[deployment];
    if (!status) warnings.push(`${deployment}: no stream status is available.`);
    else if (!['streaming', 'waiting for events'].includes(status.state)) {
      warnings.push(`${deployment}: ${status.state}${status.error ? ` (${status.error})` : ''}.`);
    }
  }
  // A quiet deployment can legitimately have an old lastEventAt; do not call it offline.
  return { healthy: warnings.length === 0, warnings };
}

function summary() {
  const state = readJson('events.json', { events: [], deployments: {} });
  const ack = new Set(readJson('acknowledged.json', []));
  const pending = state.events.filter(event => !ack.has(event.id));
  const lock = readJson('watcher.json', {});
  const running = alive(lock.pid);
  console.log(JSON.stringify({
    running,
    ...monitorHealth(state, running),
    checkedAt: new Date().toISOString(),
    lastCaptureUpdate: state.updatedAt,
    deployments: state.deployments,
    pendingCount: pending.length,
    events: pending.slice(0, 50),
    discardedEvents: state.discardedEvents || 0,
    limitation: 'Local CLI stream; stops while this computer is off. Convex log retention limits recovery after interruptions.',
  }, null, 2));
}

function acknowledge(ids) {
  const ack = new Set(readJson('acknowledged.json', []));
  const available = new Set(readJson('events.json', { events: [] }).events.map(event => event.id));
  for (const id of ids) if (available.has(id)) ack.add(id);
  writeJson('acknowledged.json', [...ack].slice(-MAX_SEEN));
  console.log(JSON.stringify({ acknowledged: ids.filter(id => ack.has(id)).length }));
}

function watch() {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const existing = readJson('watcher.json', {});
  if (alive(existing.pid)) throw new Error('The Convex error watcher is already running.');
  // Exclusive lock prevents two startup requests from launching duplicate streams.
  if (existing.pid) unlinkSync(join(STATE_DIR, 'watcher.json'));
  writeFileSync(join(STATE_DIR, 'watcher.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  const state = readJson('events.json', { events: [], seen: [], deployments: {}, discardedEvents: 0 });
  const secrets = knownSecrets();
  const children = new Set();
  let stopping = false;
  let pendingWrite;
  const persist = () => { state.updatedAt = Date.now(); writeJson('events.json', state); };
  const scheduleWrite = () => { pendingWrite ??= setTimeout(() => { pendingWrite = undefined; persist(); }, 250); };
  const heartbeat = setInterval(persist, 30_000);
  const run = (deployment, attempt = 0) => {
    if (stopping) return;
    const status = state.deployments[deployment] = { state: 'starting', startedAt: Date.now() };
    scheduleWrite();
    const child = spawn(process.execPath, [join(ROOT, 'node_modules/convex/bin/main.js'), 'logs', '--deployment', deployment, '--jsonl', '--history'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' },
    });
    children.add(child);
    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      status.state = 'streaming';
      status.lastEventAt = Date.now();
      delete status.error;
      appendEvents(state, failureEvents(deployment, event, secrets));
      scheduleWrite();
    });
    const stderr = createInterface({ input: child.stderr });
    stderr.on('line', line => {
      if (/Watching logs/.test(line)) status.state = 'waiting for events';
      else if (/error|failed|not authorized|log in/i.test(line)) {
        status.state = 'connection warning';
        // CLI messages may print environment details, so persist a fixed diagnosis only.
        status.error = /403|not authorized|log in|authenticat/i.test(line) ? 'Convex CLI authentication needs attention.' : 'Convex CLI reported a connection failure.';
      }
      scheduleWrite();
    });
    child.on('error', () => { status.state = 'failed to start'; scheduleWrite(); });
    child.on('close', code => {
      children.delete(child); stdout.close(); stderr.close();
      status.state = stopping ? 'stopped' : 'reconnecting';
      status.exitCode = code;
      scheduleWrite();
      if (!stopping) setTimeout(() => run(deployment, attempt + 1), Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5)));
    });
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    clearTimeout(pendingWrite);
    for (const child of children) child.kill('SIGTERM');
    persist();
    try { unlinkSync(join(STATE_DIR, 'watcher.json')); } catch { /* already removed */ }
    setTimeout(() => process.exit(0), 1_000);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  for (const deployment of DEPLOYMENTS) run(deployment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  try {
    if (mode === '--watch') watch();
    else if (mode === '--summary') summary();
    else if (mode === '--ack') acknowledge(process.argv.slice(3));
    else if (mode === '--start') {
      const existing = readJson('watcher.json', {});
      if (alive(existing.pid)) console.log(JSON.stringify({ alreadyRunning: true, pid: existing.pid }));
      else {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch'], { cwd: ROOT, stdio: 'ignore', detached: true });
        child.unref();
        console.log(JSON.stringify({ startedPid: child.pid, stateDirectory: STATE_DIR }));
      }
    } else throw new Error('Use --start, --watch, --summary, or --ack <event ids>.');
  } catch (error) { console.error(redactError(error.message)); process.exitCode = 1; }
}
