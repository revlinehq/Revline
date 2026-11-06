import * as transitions from './transitions-runtime';

// The footage transition renderer's own bundle (public/vendor/transitions-runtime.js): plain DOM, no React or Remotion.
(window as unknown as Window & { __revlineTransitions: typeof transitions }).__revlineTransitions = transitions;
export { transitions };
