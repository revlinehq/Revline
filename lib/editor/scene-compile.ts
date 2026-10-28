import { transform } from 'sucrase';
import { SCENE_MODULES } from './scene-modules';

/** Catch syntax and import mistakes before a scene is saved; build and render errors surface in the preview. */
export function checkSceneCode(code: string) {
  let compiled: string;
  try {
    compiled = transform(code, { transforms: ['typescript', 'imports'], production: true }).code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene code does not compile: ${message}${/<[A-Za-z]/.test(code) ? ' Scenes are plain TypeScript, not JSX: build HTML with innerHTML or document.createElement.' : ''}`);
  }
  for (const match of compiled.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!SCENE_MODULES.has(match[1])) throw new Error(`Scenes can import only gsap and its plugins, not "${match[1]}".`);
  }
  if (!/exports\.default\s*=|exports,\s*["']default["']/.test(compiled)) throw new Error('A scene must export default a function that builds it.');
}
