import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Timeline } from '../editor/types';
import { usesSceneThree } from '../editor/scene-modules';
import { modelResourceUris } from '../editor/scene-three-resources';

/** Pin declared 3D resources beside the composition so capture and export need no external network. */
export async function prepareSceneThreeResources(directory: string, timeline: Timeline, signal: AbortSignal) {
  const urls = new Set<string>();
  for (const clip of timeline.clips) {
    const scene = clip.scene;
    if (!scene || !usesSceneThree(scene)) continue;
    for (const source of [scene, ...(scene.blueprints ?? [])]) {
      for (const match of source.code.matchAll(/['"`](https:\/\/[^'"`\s<>]+)['"`]/g)) {
        const url = new URL(match[1]);
        if (/\.(?:glb|gltf|json)$/i.test(url.pathname)) urls.add(url.href);
      }
    }
  }
  const files: Record<string, string> = {};
  let total = 0;
  const save = async (url: string, model: boolean) => {
    if (files[url]) return;
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('3D resources need public HTTPS URLs without credentials.');
    const response = await fetch(target, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    if (!response.ok || !response.body) throw new Error(`3D resource could not load (HTTP ${response.status}): ${target.pathname}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.length; total += chunk.length;
      if (size > 32 * 1024 * 1024 || total > 96 * 1024 * 1024) throw new Error('3D resources exceed the CPU scene budget (32 MB each, 96 MB total). Use smaller project GLB models.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const name = `scene-3d-resource-${Object.keys(files).length}${/\.[a-z0-9]+$/i.exec(target.pathname)?.[0] ?? '.bin'}`;
    await writeFile(join(directory, name), bytes);
    files[url] = `./${name}`;
    if (model) for (const uri of modelResourceUris(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) await save(new URL(uri, target).href, false);
  };
  for (const url of urls) await save(url, /\.(?:glb|gltf)$/i.test(new URL(url).pathname));
  return files;
}
