import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureRenderFfmpeg } from '../render-resources.mjs';

const directory = await mkdtemp(join(tmpdir(), 'revline-render-pipe-'));
try {
  configureRenderFfmpeg(directory);
  const source = join(directory, 'source.mp4');
  execFileSync(process.env.REVLINE_RENDER_FFMPEG_BINARY, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=240x240:r=30:d=2', '-c:v', 'libx264', '-threads', '1', '-y', source]);
  function runPipeline(index) {
    const producer = spawn(process.env.HYPERFRAMES_FFMPEG_PATH, ['-v', 'error', '-i', source, '-an', '-c:v', 'rawvideo', '-f', 'nut', 'pipe:1']);
    const output = join(directory, `pipeline-${index}.mp4`);
    const consumer = spawn(process.env.HYPERFRAMES_FFMPEG_PATH, ['-v', 'error', '-f', 'nut', '-i', 'pipe:0', '-vf', 'fps=30', '-c:v', 'libx264', '-y', output]);
    consumer.stdin.on('error', () => {});
    producer.stdout.pipe(consumer.stdin);
    producer.stdin.end(); consumer.stdout.resume();
    let errors = '';
    producer.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2000); });
    consumer.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2000); });
    const timeout = setTimeout(() => { producer.kill('SIGTERM'); consumer.kill('SIGTERM'); }, 10_000);
    const waits = [producer, consumer].map(child => new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(errors || `Pipeline exited ${code}`))); }));
    return Promise.all(waits).finally(() => clearTimeout(timeout)).then(() => {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,width,height', '-show_entries', 'format=duration', '-of', 'json', output], { encoding: 'utf8' }));
      assert.equal(Number(probe.streams[0].nb_frames), 60);
      assert.equal(probe.streams[0].width, 240);
      assert.equal(probe.streams[0].height, 240);
      assert.equal(Number(probe.format.duration), 2);
    });
  }
  await Promise.all([runPipeline(0), runPipeline(1)]);
  console.log('Concurrent file-decoder/raw-pipe consumer pairs completed without a lock deadlock; both outputs have all 60 frames.');
  const producer = spawn(process.env.HYPERFRAMES_FFMPEG_PATH, ['-v', 'error', '-re', '-stream_loop', '-1', '-i', source, '-an', '-c:v', 'rawvideo', '-f', 'nut', 'pipe:1']);
  const consumer = spawn(process.env.HYPERFRAMES_FFMPEG_PATH, ['-v', 'error', '-f', 'nut', '-i', 'pipe:0', '-f', 'null', '-']);
  producer.stdin.end(); consumer.stdout.resume(); producer.stderr.resume(); consumer.stderr.resume();
  consumer.stdin.on('error', () => {}); producer.stdout.pipe(consumer.stdin);
  const closed = Promise.all([producer, consumer].map(child => new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); })));
  await new Promise(resolve => setTimeout(resolve, 200));
  const cancelledAt = Date.now(); producer.kill('SIGTERM'); consumer.kill('SIGTERM');
  const timeout = setTimeout(() => { producer.kill('SIGKILL'); consumer.kill('SIGKILL'); }, 3000);
  await closed; clearTimeout(timeout);
  assert.ok(Date.now() - cancelledAt < 2500, 'Cancelling the raw pipeline left native work alive.');
  console.log('Cancelling the active file-decoder/raw-pipe consumer pair reaped both managed child PIDs.');
} finally { await rm(directory, { recursive: true, force: true }); }
