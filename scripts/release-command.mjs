import { spawn } from 'node:child_process';

let tail = '';
const secrets = new Set();
export function mask(values) {
  for (const [name, value] of Object.entries(values)) if (/secret|token|key|password|webhook|dsn/i.test(name) && value?.length > 8) secrets.add(value);
}
export function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/https:\/\/discord\.com\/api\/webhooks\/[^\s"']+/g, '[Discord webhook]')
    .replace(/(?:gh[pousr]_|sk_(?:live|test)_)[\w-]+/g, '[redacted]')
    .replace(/\u001b\[[0-9;]*m/g, '');
}
export const logTail = () => redact(tail).slice(-7000);
export function command(cmd, args, { quiet = false, env = process.env, cwd = process.cwd(), input } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      const print = text => {
        if (quiet) return;
        const safe = redact(text);
        tail = (tail + safe).slice(-12000);
        (stream === child.stdout ? process.stdout : process.stderr).write(safe);
      };
      stream.on('data', chunk => {
        if (stream === child.stdout) output += chunk;
        pending += chunk.toString();
        const end = pending.lastIndexOf('\n');
        if (end >= 0) { print(pending.slice(0, end + 1)); pending = pending.slice(end + 1); }
      });
      stream.on('end', () => print(pending));
    }
    child.on('error', reject);
    child.on('exit', code => code === 0 ? accept(output.trim()) : reject(new Error(`${cmd} ${args[0]} failed (exit ${code}).${quiet ? ' Sensitive output withheld.' : ''}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
