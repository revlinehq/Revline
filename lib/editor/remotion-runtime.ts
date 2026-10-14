import * as text from './remotion-text-runtime';
import * as transitions from './remotion-transitions-runtime';

// One bundle shares React/ReactDOM/Remotion between the optional scene renderers.
const host = window as unknown as Window & { __revlineRemotionText: typeof text; __revlineRemotionTransitions: typeof transitions };
host.__revlineRemotionText = text;
host.__revlineRemotionTransitions = transitions;
export { text, transitions };
