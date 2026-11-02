import type { Clip, Timeline } from './types';

/**
 * Stored timelines keep scene and blueprint code out of the timeline record: each code moves to a
 * sceneCode row keyed by its SHA-256, and the scene keeps `code: ''` with `codeRef` set to that hash.
 * Every edit rewrites (and every open editor re-reads) the timeline, so this keeps both small, and
 * identical code is stored once. Editing logic only ever sees timelines with their code restored.
 */
export async function sceneCodeHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

type Scene = NonNullable<Clip['scene']>;
const stored = (item: { code: string; codeRef?: string }) => !item.code && !!item.codeRef;

/** Hashes a stored timeline's scenes point at whose code is not inline. */
export function sceneCodeRefs(timeline: Pick<Timeline, 'clips'>): string[] {
  const refs = new Set<string>();
  for (const clip of timeline.clips) {
    if (!clip.scene) continue;
    if (stored(clip.scene)) refs.add(clip.scene.codeRef!);
    for (const blueprint of clip.scene.blueprints ?? []) if (stored(blueprint)) refs.add(blueprint.codeRef!);
  }
  return [...refs];
}

/** Put each scene's code back; null while any code is unavailable. */
export function withSceneCode<T extends Pick<Timeline, 'clips'>>(timeline: T, code: (hash: string) => string | null | undefined): T | null {
  if (!timeline.clips.some(clip => clip.scene)) return timeline;
  let missing = false;
  const restore = <I extends { code: string; codeRef?: string }>(item: I): I => {
    if (!stored(item)) return item;
    const text = code(item.codeRef!);
    if (typeof text !== 'string') { missing = true; return item; }
    const { codeRef: _ref, ...rest } = item;
    return { ...rest, code: text } as I;
  };
  const clips = timeline.clips.map(clip => {
    if (!clip.scene) return clip;
    const scene: Scene = restore(clip.scene);
    return { ...clip, scene: scene.blueprints ? { ...scene, blueprints: scene.blueprints.map(restore) } : scene };
  });
  return missing ? null : { ...timeline, clips };
}

/** The stored form: code replaced by its hash, plus the code to save under each hash. */
export async function withoutSceneCode<T extends Pick<Timeline, 'clips'>>(timeline: T): Promise<{ timeline: T; code: Map<string, string> }> {
  const code = new Map<string, string>();
  if (!timeline.clips.some(clip => clip.scene)) return { timeline, code };
  const move = async <I extends { code: string; codeRef?: string }>(item: I): Promise<I> => {
    if (!item.code) return item;
    const hash = await sceneCodeHash(item.code);
    code.set(hash, item.code);
    return { ...item, code: '', codeRef: hash };
  };
  const clips = await Promise.all(timeline.clips.map(async clip => {
    if (!clip.scene) return clip;
    const scene = await move(clip.scene);
    return { ...clip, scene: scene.blueprints ? { ...scene, blueprints: await Promise.all(scene.blueprints.map(move)) } : scene };
  }));
  return { timeline: { ...timeline, clips }, code };
}

/** Serialized size of a timeline as stored, with each code counted as its hash. */
export function storedTimelineBytes(timeline: unknown) {
  return new TextEncoder().encode(JSON.stringify(timeline, (key, value) => key === 'code' && typeof value === 'string' && value.length > 64 ? '#'.repeat(64) : value)).byteLength;
}
