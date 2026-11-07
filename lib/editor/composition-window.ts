import type { gsap } from 'gsap';
import type { AdjustmentController } from './adjustment-layers';
import type { AudioReactiveController } from './audio-reactive';
import type { MaskController } from './masks';
import type { TextLayerController } from './text-template-runtime';
import type { TransitionController, TransitionSource } from './transitions-runtime';
import type { SceneLayerSource } from './scene-layers';
import type { SolidColorController } from './solid-color-layers';
import type { TextLayerSource } from './text-layers';
import type { VisualEffectsController } from './visual-effects-runtime';
import type { VisualFadeController } from './visual-fades-runtime';

/**
 * The globals a composition page (lib/editor/composition.ts) and its runtimes put on the iframe's window,
 * as the editor reads them from outside. Every one is optional: a page only has the runtimes its clips need.
 * Types only; nothing here runs.
 */
export type CompositionWindow = Window & {
  gsap?: typeof gsap;
  /** The composition clock. HyperFrames may wrap it; `__hfReal` is then the underlying timeline. */
  __timelines?: { revline?: gsap.core.Timeline & { __hfReal?: gsap.core.Timeline } };
  __revlineDurationTween?: gsap.core.Tween;
  __revlineNextMediaIndex?: number;
  __revlineSourceTimelines?: Record<string, gsap.core.Timeline>;
  __revlineEffects?: VisualEffectsController;
  __revlineAdjustmentController?: AdjustmentController;
  __revlineSolidColorController?: SolidColorController;
  __revlineTransitionController?: TransitionController;
  __revlineMaskController?: MaskController;
  __revlineAudioReactive?: AudioReactiveController;
  __revlineVisualFadeController?: VisualFadeController;
  __revlineTextLayerController?: TextLayerController;
  __revlineSceneController?: { setSources(sources: SceneLayerSource[]): void; hasMedia?(assetId: string): boolean };
  /** Optional renderers the preview loads on demand (lib/editor/preview-runtimes.ts). */
  __revlineTextRuntime?: { installTextLayers(sources: TextLayerSource[]): TextLayerController };
  __revlineTransitions?: { installTransitions(initial: TransitionSource[], fps: number): TransitionController };
  __renderReady?: boolean;
  /** The HyperFrames player bridge; the preview reserves it before GSAP loads. */
  __player?: { isPlaying?(): boolean; getTime?(): number; getDuration?(): number };
};

