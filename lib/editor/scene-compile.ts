import { transform } from 'sucrase';

const MODULES = new Set(['react', 'react/jsx-runtime', 'revline']);

/** Catch syntax and import mistakes before a scene is saved; render errors surface in the preview. */
export function checkSceneCode(code: string) {
  let compiled: string;
  try {
    compiled = transform(code, { transforms: ['jsx', 'typescript', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  } catch (error) {
    throw new Error(`Scene code does not compile: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const match of compiled.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!MODULES.has(match[1])) throw new Error(`Scenes can import only "react" and "revline", not "${match[1]}".`);
  }
  if (!/exports\.default\s*=|exports,\s*["']default["']/.test(compiled)) throw new Error('A scene must export default a React component.');
}
