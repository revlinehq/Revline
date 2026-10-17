import { expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ children: [] }));
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return { spawn: (_node, args) => { const child = Object.assign(new EventEmitter(), { args, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }); fixture.children.push(child); return child; } };
});
test('the read-only cost tail is optional while web/worker failures still stop development services', async () => {
  const previousExitCode = process.exitCode, previousListeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('./dev.mjs');
    const [web, worker, tail] = fixture.children;
    expect(tail.args).toEqual(['node_modules/convex/bin/main.js', 'logs', '--deployment', 'dev', '--history', '0', '--jsonl']);
    tail.emit('exit', 1, null);
    expect(web.kill).not.toHaveBeenCalled(); expect(worker.kill).not.toHaveBeenCalled();
    web.emit('exit', 1, null);
    expect(worker.kill).toHaveBeenCalledWith('SIGTERM');
  } finally {
    process.exitCode = previousExitCode;
    for (const [signal, before] of previousListeners) for (const listener of process.listeners(signal)) if (!before.includes(listener)) process.removeListener(signal, listener);
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  }
});
