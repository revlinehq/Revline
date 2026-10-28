/** GSAP plugins bundled into the scene frame; a scene imports each from `gsap/<Name>` (or all from `gsap`). */
export const SCENE_GSAP_PLUGINS = ['CustomEase', 'CustomWiggle', 'CustomBounce', 'SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin', 'ScrambleTextPlugin', 'TextPlugin'] as const;
export type SceneGsapPlugin = typeof SCENE_GSAP_PLUGINS[number];

/** Every module name a scene may import. */
export const SCENE_MODULES = new Set<string>(['gsap', 'gsap/all', 'gsap/EasePack', ...SCENE_GSAP_PLUGINS.map(name => `gsap/${name}`)]);
