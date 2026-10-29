/** GSAP plugins bundled into the scene frame; a scene imports each from `gsap/<Name>` (or all from `gsap`). */
export const SCENE_GSAP_PLUGINS = ['CustomEase', 'CustomWiggle', 'CustomBounce', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin', 'ScrambleTextPlugin', 'TextPlugin'] as const;
export type SceneGsapPlugin = typeof SCENE_GSAP_PLUGINS[number];

/** Every module name a scene may import. */
export const SCENE_MODULES = new Set<string>(['gsap', 'gsap/all', 'gsap/EasePack', ...SCENE_GSAP_PLUGINS.map(name => `gsap/${name}`)]);

/** Opt-in React scenes: a module that imports from 'revline' (or 'react') is a component tree drawn per frame. */
export const REACT_SCENE_MODULES = new Set<string>(['revline', 'react', 'react/jsx-runtime']);
export const REACT_SCENE_PATTERN = /\bfrom\s*['"](?:revline|react)['"]/;
export const isReactScene = (code: string) => REACT_SCENE_PATTERN.test(code);
/** Sucrase options for a scene: React scenes compile as TSX with the automatic JSX runtime. */
export const sceneTransformOptions = (code: string) => isReactScene(code)
  ? { transforms: ['typescript', 'jsx', 'imports'] as ('typescript' | 'jsx' | 'imports')[], jsxRuntime: 'automatic' as const, production: true }
  : { transforms: ['typescript', 'imports'] as ('typescript' | 'jsx' | 'imports')[], production: true };
