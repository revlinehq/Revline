import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const linux = process.platform === 'linux' ? describe : describe.skip;
linux('render FFmpeg resource gate', () => {
  it('preserves the configured FFmpeg binary when selecting the guarded launcher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revline-ffmpeg-override-')); directories.push(directory);
    const names = ['HYPERFRAMES_FFMPEG_PATH', 'REVLINE_RENDER_FFMPEG_BINARY', 'REVLINE_RENDER_FFMPEG_LOCK'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      process.env.HYPERFRAMES_FFMPEG_PATH = join(directory, 'custom ffmpeg');
      const { configureRenderFfmpeg } = await import('./render-resources.mjs');
      configureRenderFfmpeg(directory);
      assert.equal(process.env.REVLINE_RENDER_FFMPEG_BINARY, join(directory, 'custom ffmpeg'));
      assert.equal(process.env.REVLINE_RENDER_FFMPEG_LOCK, join(directory, '.render-ffmpeg.lock'));
      assert.equal(process.env.HYPERFRAMES_FFMPEG_PATH, join(process.cwd(), 'scripts/render-ffmpeg.sh'));
    } finally { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } }
  });
  it('lets a stdin alias consumer drain a decoder while its file lock is held', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revline-ffmpeg-stdin-')); directories.push(directory);
    const fake = join(directory, 'fake-ffmpeg');
    await writeFile(fake, '#!/bin/bash\nprintf "START:%s\\n" "$TEST_GATE_LABEL" >> "$TEST_GATE_EVENTS"\nsleep "$TEST_GATE_DELAY"\nprintf "END:%s\\n" "$TEST_GATE_LABEL" >> "$TEST_GATE_EVENTS"\n');
    await chmod(fake, 0o755);
    const env = { ...process.env, REVLINE_RENDER_FFMPEG_BINARY: fake, REVLINE_RENDER_FFMPEG_LOCK: join(directory, 'gate.lock'), TEST_GATE_EVENTS: join(directory, 'events') };
    const run = (input: string, label: string, delay: string) => new Promise<void>((resolve, reject) => { const child = spawn(join(process.cwd(), 'scripts/render-ffmpeg.sh'), ['-i', input, '-f', 'null', '-'], { env: { ...env, TEST_GATE_LABEL: label, TEST_GATE_DELAY: delay } }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg wrapper exited ${code}`))); });
    const decoder = run('source.mp4', 'decoder', '.3');
    for (let attempt = 0; attempt < 50 && !(await readFile(env.TEST_GATE_EVENTS, 'utf8').catch(() => '')).includes('START:decoder'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    await run('-', 'consumer', '.01'); await decoder;
    assert.equal(await readFile(env.TEST_GATE_EVENTS, 'utf8'), 'START:decoder\nSTART:consumer\nEND:consumer\nEND:decoder\n');
  });
  it('serializes file inputs, preserves argument boundaries and bounds decoder/filter/output threads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'revline-ffmpeg-gate-')); directories.push(directory);
    const fake = join(directory, 'fake ffmpeg');
    await writeFile(fake, '#!/bin/bash\nset -eu\nprintf "START\\n" >> "$TEST_GATE_EVENTS"\nprintf "%s\\n" "$@" >> "$TEST_GATE_ARGS"\nsleep .1\nprintf "END\\n" >> "$TEST_GATE_EVENTS"\n');
    await chmod(fake, 0o755);
    const env = { ...process.env, REVLINE_RENDER_FFMPEG_BINARY: fake, REVLINE_RENDER_FFMPEG_LOCK: join(directory, 'gate.lock'), TEST_GATE_EVENTS: join(directory, 'events'), TEST_GATE_ARGS: join(directory, 'args') };
    const run = () => new Promise<void>((resolve, reject) => { const child = spawn(join(process.cwd(), 'scripts/render-ffmpeg.sh'), ['-v', 'error', '-i', 'source with spaces.mp4', '-f', 'null', '-'], { env }); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg wrapper exited ${code}`))); });
    await Promise.all([run(), run(), run()]);
    assert.equal(await readFile(env.TEST_GATE_EVENTS, 'utf8'), 'START\nEND\nSTART\nEND\nSTART\nEND\n');
    assert.equal((await readFile(env.TEST_GATE_ARGS, 'utf8')).split('source with spaces.mp4').length - 1, 3);
    assert.match(await readFile(env.TEST_GATE_ARGS, 'utf8'), /-threads\n1\n-i\nsource with spaces.mp4/);
    assert.match(await readFile(env.TEST_GATE_ARGS, 'utf8'), /-filter_threads\n1\n-filter_complex_threads\n1/);
    assert.match(await readFile(env.TEST_GATE_ARGS, 'utf8'), /-threads\n1\n-\n/);
  });
});
