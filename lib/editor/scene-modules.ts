/** GSAP plugins bundled into the scene frame; a scene imports each from `gsap/<Name>` (or all from `gsap`). */
export const SCENE_GSAP_PLUGINS = ['CustomEase', 'CustomWiggle', 'CustomBounce', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin', 'ScrambleTextPlugin', 'TextPlugin'] as const;
export type SceneGsapPlugin = typeof SCENE_GSAP_PLUGINS[number];

/** Import policy, bundle names and load order shared by saving, preview, capture and export.
 * Optional renderers precede the core runtime, which posts the frame's ready message. */
export const SCENE_RUNTIME_BUNDLES = {
  react: { file: 'scene-react.js', entry: 'lib/editor/scene-react-runtime.tsx', global: '__revlineSceneReact', label: 'React scene renderer', modules: ['revline', 'react', 'react/jsx-runtime'] },
  three: { file: 'scene-three.js', entry: 'lib/editor/scene-three-runtime.tsx', global: '__revlineSceneThree', label: '3D scene renderer', modules: ['revline/three', 'three'] },
  gsap: { file: 'scene-runtime.js', entry: 'lib/editor/scene-runtime.ts', global: '__revlineSceneRuntime', label: 'scene renderer', modules: ['gsap', 'gsap/all', 'gsap/EasePack', ...SCENE_GSAP_PLUGINS.map(name => `gsap/${name}` as const)] },
} as const;
export type SceneRuntimeName = keyof typeof SCENE_RUNTIME_BUNDLES;
/** Each runtime must implement every import it advertises. */
export type SceneRuntimeModules<Name extends SceneRuntimeName> = Record<typeof SCENE_RUNTIME_BUNDLES[Name]['modules'][number], unknown>;

export function sceneModuleRuntime(name: string): SceneRuntimeName | undefined {
  return (Object.keys(SCENE_RUNTIME_BUNDLES) as SceneRuntimeName[]).find(runtime => SCENE_RUNTIME_BUNDLES[runtime].modules.some(module => module === name));
}

/** The same policy guards compiled require calls at save time and inside the sandbox. */
export function assertSceneImport(name: string, react: boolean) {
  const runtime = sceneModuleRuntime(name);
  if (runtime === 'gsap' || (react && (runtime || name.startsWith('blueprint:')))) return runtime;
  const allowed = Object.values(SCENE_RUNTIME_BUNDLES).filter(bundle => react || bundle === SCENE_RUNTIME_BUNDLES.gsap).flatMap(bundle => [...bundle.modules]);
  throw new Error(`${react ? 'React scenes' : 'Scenes'} can import only ${allowed.join(', ')}${react ? ' and blueprint:<name>' : ''}, not "${name}".`);
}

/** Recognise all literal import forms accepted by compilation, including side effects and require. */
function sceneImports(code: string) {
  const gap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*(?:\n|$))*`;
  const pattern = new RegExp(String.raw`\b(?:from${gap}|import${gap}|require${gap}\(${gap})['"]([^'"]+)['"]`, 'g');
  return [...code.matchAll(pattern)].map(match => match[1]);
}
/** React-only modules and component kits opt into TSX, including a scene importing only three. */
export const isReactScene = (code: string) => sceneImports(code).some(name => {
  const runtime = sceneModuleRuntime(name);
  return name.startsWith('blueprint:') || (runtime !== undefined && runtime !== 'gsap');
});

export type SceneModuleSource = { code: string; blueprints?: SceneModuleSource[]; neighbours?: SceneModuleSource[] };
/** Include kits and transition neighbours, using the same module registry as validation. */
export function sceneRuntimeNames(source: SceneModuleSource): SceneRuntimeName[] {
  const needed = new Set<SceneRuntimeName>(['gsap']);
  const visit = (scene: SceneModuleSource) => {
    if (isReactScene(scene.code)) needed.add('react');
    for (const name of sceneImports(scene.code)) {
      const runtime = sceneModuleRuntime(name);
      if (runtime) needed.add(runtime);
    }
    scene.blueprints?.forEach(visit);
    scene.neighbours?.forEach(visit);
  };
  visit(source);
  return (Object.keys(SCENE_RUNTIME_BUNDLES) as SceneRuntimeName[]).filter(name => needed.has(name));
}
export const usesSceneThree = (source: SceneModuleSource) => sceneRuntimeNames(source).includes('three');
/** A React scene that joins the beat clips on either side of it (it draws <Transition> or <Neighbour>). */
export const isSceneTransition = (code: string) => isReactScene(code) && /<(?:Transition|Neighbour)\b/.test(code);
/** Sucrase options for a scene: React scenes compile as TSX with the automatic JSX runtime. */
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

export const sceneTransformOptions = (code: string) => isReactScene(code)
  ? { transforms: ['typescript', 'jsx', 'imports'] as ('typescript' | 'jsx' | 'imports')[], jsxRuntime: 'automatic' as const, production: true }
  : { transforms: ['typescript', 'imports'] as ('typescript' | 'jsx' | 'imports')[], production: true };

const REVLINE_COMPONENTS = new Set(['Beat', 'Layer', 'Still', 'Icon', 'Blueprint', 'Fragment']);
/** Each capitalised top-level component in a module, with the source of its declaration. */
function declarations(code: string) {
  const found = [...code.matchAll(/^(?:export\s+)?(?:default\s+)?(?:const|function)\s+([A-Z]\w*)/gm)];
  return new Map(found.map((match, index) => [match[1], code.slice(match.index, found[index + 1]?.index ?? code.length)]));
}
const jsxTags = (code: string) => [...new Set([...code.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]))];

/**
 * The components a React scene clip draws, for the inspector: those it declares, plus every exported
 * component of its React blueprints that it reaches (a kit's internal helpers are walked, not listed).
 * Static: read from the code, so it works without rendering. Empty for GSAP scenes.
 */
export function sceneComponents(scene: { code: string; blueprints?: { name: string; code: string }[] }): string[] {
  if (!isReactScene(scene.code)) return [];
  const local = declarations(scene.code), defaultName = /export\s+default\s+function\s+([A-Z]\w*)/.exec(scene.code)?.[1];
  const kits = new Map((scene.blueprints ?? []).filter(item => isReactScene(item.code)).map(item => [item.name.toLowerCase(), item.code]));
  // Imported kit name -> where it is declared and whether the kit exports it.
  const imported = new Map<string, { body?: string; listed: boolean; kit: Map<string, string>; exported: Set<string> }>();
  const kitInfo = (code: string) => ({ kit: declarations(code), exported: new Set([...code.matchAll(/^export\s+(?:const|function)\s+([A-Z]\w*)/gm)].map(match => match[1])) });
  for (const match of scene.code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]blueprint:([^'"]+)['"]/g)) {
    const code = kits.get(match[2].trim().toLowerCase());
    if (!code) continue;
    const info = kitInfo(code);
    for (const part of match[1].split(',')) {
      const [name, alias = name] = part.trim().split(/\s+as\s+/);
      if (/^[A-Z]/.test(name)) imported.set(alias.trim(), { body: info.kit.get(name.trim()), listed: true, ...info });
    }
  }
  const listed: string[] = [], seen = new Set<string>();
  const visit = (name: string, scope: { kit: Map<string, string>; exported: Set<string> } | null) => {
    const key = `${scope ? 'kit' : 'clip'}:${name}`;
    if (seen.has(key) || REVLINE_COMPONENTS.has(name)) return;
    seen.add(key);
    if (scope) {
      const body = scope.kit.get(name);
      if (body === undefined) return;
      if (scope.exported.has(name) && !listed.includes(name)) listed.push(name);
      for (const tag of jsxTags(body)) visit(tag, scope);
    } else if (imported.has(name)) {
      const item = imported.get(name)!;
      if (!listed.includes(name)) listed.push(name);
      for (const tag of jsxTags(item.body ?? '')) visit(tag, item);
    } else if (local.has(name)) {
      if (name !== defaultName && !listed.includes(name)) listed.push(name);
      for (const tag of jsxTags(local.get(name)!)) visit(tag, null);
    } else if (name === 'Transition' || name === 'Neighbour') listed.push(name);
  };
  for (const tag of jsxTags(scene.code)) visit(tag, null);
  return listed;
}
