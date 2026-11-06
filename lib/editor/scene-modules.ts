/** GSAP plugins bundled into the scene frame; a scene imports each from `gsap/<Name>` (or all from `gsap`). */
export const SCENE_GSAP_PLUGINS = ['CustomEase', 'CustomWiggle', 'CustomBounce', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin', 'ScrambleTextPlugin', 'TextPlugin'] as const;
export type SceneGsapPlugin = typeof SCENE_GSAP_PLUGINS[number];

/** The scene frame's bundle: one plain HTML + GSAP runtime shared by saving, preview, capture and export. */
export const SCENE_RUNTIME_BUNDLES = {
  gsap: { file: 'scene-runtime.js', entry: 'lib/editor/scene-runtime.ts', global: '__revlineSceneRuntime', label: 'scene renderer', modules: ['gsap', 'gsap/all', 'gsap/EasePack', ...SCENE_GSAP_PLUGINS.map(name => `gsap/${name}` as const)] },
} as const;
export type SceneRuntimeName = keyof typeof SCENE_RUNTIME_BUNDLES;
/** The runtime must implement every import it advertises. */
export type SceneRuntimeModules<Name extends SceneRuntimeName> = Record<typeof SCENE_RUNTIME_BUNDLES[Name]['modules'][number], unknown>;
const SCENE_MODULES: readonly string[] = SCENE_RUNTIME_BUNDLES.gsap.modules;

/** The same policy guards compiled require calls at save time and inside the sandbox. */
export function assertSceneImport(name: string) {
  if (SCENE_MODULES.includes(name)) return;
  if (name === 'revline' || name.startsWith('revline/') || name === 'react' || name.startsWith('react/') || name.startsWith('blueprint:') || name === 'three' || name.startsWith('three/') || name.startsWith('@react-three/')) {
    throw new Error(`Scenes and films are plain HTML + GSAP modules; "${name}" (React, JSX, 3D or blueprint:film kits) is not supported. Build the HTML into root and put every tween on tl (or a section's tl).`);
  }
  throw new Error(`Scenes can import only ${SCENE_MODULES.join(', ')}, not "${name}".`);
}

/** Recognise all literal import forms accepted by compilation, including side effects and require. */
function sceneImports(code: string) {
  const gap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*`;
  const pattern = new RegExp(String.raw`\b(?:from${gap}|import${gap}(?:\(${gap})?|require${gap}\(${gap})['"]([^'"]+)['"]`, 'g');
  return [...code.matchAll(pattern)].map(match => match[1]);
}
/** Checked before compiling, so a React or 3D import gets the plain-module message rather than a JSX syntax error. */
export function assertSceneAuthoringImports(code: string) {
  for (const name of sceneImports(code)) assertSceneImport(name);
}

/** Sucrase compiles `export const a = 1, b = 2;` to `const a = 1; exports.a = a, b = 2;`, leaving b undeclared ("b is
 * not defined" at render). Every scene and kit is written one export per name before it is compiled or read for names. */
export function splitExportDeclarations(code: string) {
  let out = '', index = 0;
  const pattern = /\bexport\s+(const|let|var)\s+/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const kind = match[1], start = match.index + match[0].length;
    // Read one statement: commas at depth 0 separate its declarators; it ends at a depth-0 semicolon, or at a
    // line break followed by the next top-level statement.
    const parts: string[] = [];
    let depth = 0, from = start, at = start, quote = '', templates: number[] = [];
    for (; at < code.length; at++) {
      const char = code[at];
      if (quote) {
        if (char === '\\') { at++; continue; }
        if (quote === '`' && char === '$' && code[at + 1] === '{') { templates.push(depth); depth++; quote = ''; at++; continue; }
        if (char === quote) quote = '';
        continue;
      }
      if (char === '/' && code[at + 1] === '/') { const end = code.indexOf('\n', at); at = end < 0 ? code.length : end - 1; continue; }
      if (char === '/' && code[at + 1] === '*') { const end = code.indexOf('*/', at + 2); at = end < 0 ? code.length : end + 1; continue; }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '(' || char === '[' || char === '{') { depth++; continue; }
      if (char === ')' || char === ']' || char === '}') { depth--; if (templates.length && depth === templates[templates.length - 1]) { templates.pop(); quote = '`'; } continue; }
      if (depth) continue;
      if (char === ',') { parts.push(code.slice(from, at)); from = at + 1; continue; }
      if (char === ';' || (char === '\n' && /^\s*(?:export|import|function|const|let|var|class|interface|type|enum|async)\b/.test(code.slice(at + 1, at + 40)))) break;
    }
    parts.push(code.slice(from, at));
    pattern.lastIndex = at;
    if (parts.length < 2 || parts.some(part => !/^\s*[A-Za-z_$][\w$]*\s*(?::[^=]+)?=/.test(part))) continue;
    out += code.slice(index, match.index) + parts.map(part => `export ${kind} ${part.trim()}`).join('; ');
    index = at;
  }
  return out + code.slice(index);
}

/** Sucrase options for a scene: TypeScript compiled to CommonJS. */
export const sceneTransformOptions = { transforms: ['typescript', 'imports'] as ('typescript' | 'imports')[], production: true };
