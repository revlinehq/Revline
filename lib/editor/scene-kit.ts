import type { Clip, Timeline } from './types';
import { checkSceneCode } from './scene-compile';
import { isReactScene } from './scene-modules';
import type { SceneBlueprint } from './scene-layers';

/**
 * A film's shared code: one React module (the product UI components, type helpers, stage, palette) that every
 * beat clip imports as `import { AppWindow } from 'blueprint:film'`. It rides on the blueprint mechanism, so the
 * runtime, exports, frames, filmstrips and share copies need nothing new, and code stored by hash keeps one copy.
 * Writing it once is what keeps each beat clip down to its own beat.
 */
export const FILM_KIT = 'film';
const FILM_KIT_IMPORT = /\bfrom\s*['"]blueprint:\s*film\s*['"]/i;
type Scene = NonNullable<Clip['scene']>;

export const importsFilmKit = (code: string) => FILM_KIT_IMPORT.test(code);
const kitOf = (scene: Pick<Scene, 'blueprints'> | undefined) => scene?.blueprints?.find(item => item.name.toLowerCase() === FILM_KIT);

/** The film kit already on the timeline (every clip that mounts it holds the same code). */
export function timelineFilmKit(timeline: Pick<Timeline, 'clips'>) {
  for (const clip of timeline.clips) { const kit = kitOf(clip.scene); if (kit) return kit.code; }
  return undefined;
}

/** Check kit code and make it a React module, so a kit of plain helpers and constants still loads as one. */
export function prepareFilmKit(code: string) {
  const kit = isReactScene(code) ? code : `import {} from 'revline'; ${code}`;
  // A kit has no default export; appending one after the code keeps compile errors on the kit's own lines.
  try { checkSceneCode(`${kit}\nexport default function __FilmKit() { return null; }`); }
  catch (error) { throw new Error(`The film kit: ${error instanceof Error ? error.message : String(error)}`); }
  return kit;
}

/** Names a module exports, or null when it re-exports in a way this cannot read. */
function exportedNames(code: string): Set<string> | null {
  if (/\bexport\s*\*|\bexport\s+(?:const|let|var)\s*[{[]/.test(code)) return null;
  const names = new Set([...code.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
  for (const list of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const part of list[1].split(',')) { const name = part.trim().split(/\s+as\s+/).pop()?.trim(); if (name) names.add(name); }
  return names;
}

/** A beat that imports a name the kit does not export fails only when it renders; say so before it is saved. */
export function checkFilmKitImports(sceneCode: string, kitCode: string) {
  const exported = exportedNames(kitCode);
  if (!exported) return;
  const wanted = [...sceneCode.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]blueprint:\s*film\s*['"]/gi)].flatMap(match => match[1].split(',').map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean));
  const missing = [...new Set(wanted)].filter(name => !exported.has(name));
  if (missing.length) throw new Error(`The film kit does not export ${missing.join(', ')}. It exports ${[...exported].join(', ') || 'nothing'}. Add ${missing.length > 1 ? 'them' : 'it'} to the kit (pass kit with the whole updated kit code) or import only what it exports.`);
}

/** The scene's blueprints with the film kit mounted when a call passes it (the first beat carries it) or the code imports it. */
export function mountFilmKit(code: string, blueprints: SceneBlueprint[] | undefined, passed: string | undefined, existing: string | undefined): SceneBlueprint[] | undefined {
  const others = (blueprints ?? []).filter(item => item.name.toLowerCase() !== FILM_KIT), kitCode = passed ?? existing;
  if (!passed && !importsFilmKit(code)) return blueprints;
  if (!kitCode) throw new Error(`This scene imports from 'blueprint:film', but the timeline has no film kit yet. Pass kit with the film's shared code (components, helpers, styles) on this call.`);
  checkFilmKitImports(code, kitCode);
  return [...others, { name: FILM_KIT, code: kitCode }];
}

/** Every clip that mounts the film kit gets the new code, so the film keeps one shared module. */
export function withFilmKit(timeline: Timeline, kitCode: string): { timeline: Timeline; updated: string[] } {
  const updated: string[] = [];
  const clips = timeline.clips.map(clip => {
    const kit = kitOf(clip.scene);
    if (!clip.scene || !kit || kit.code === kitCode) return clip;
    checkFilmKitImports(clip.scene.code, kitCode);
    updated.push(clip.id);
    return { ...clip, scene: { ...clip.scene, blueprints: clip.scene.blueprints!.map(item => item === kit ? { name: kit.name, code: kitCode } : item) } };
  });
  return { timeline: updated.length ? { ...timeline, clips } : timeline, updated };
}
