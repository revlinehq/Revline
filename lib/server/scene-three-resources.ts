import { downloadPublicHttps } from './public-https';
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
    const resource = await downloadPublicHttps(url, { maxBytes: Math.min(32 * 1024 * 1024, 96 * 1024 * 1024 - total), signal });
    total += resource.data.byteLength;
    const bytes = Buffer.from(resource.data);
    const name = `scene-3d-resource-${Object.keys(files).length}${/\.[a-z0-9]+$/i.exec(target.pathname)?.[0] ?? '.bin'}`;
    await writeFile(join(directory, name), bytes);
    files[url] = `./${name}`;
    if (model) for (const uri of modelResourceUris(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) await save(new URL(uri, resource.url).href, false);
  };
  for (const url of urls) await save(url, /\.(?:glb|gltf)$/i.test(new URL(url).pathname));
  return files;
}
