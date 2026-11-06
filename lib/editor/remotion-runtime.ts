import * as text from './remotion-text-runtime';

// The text renderer's bundle; transitions have their own (transitions-bundle.ts).
const host = window as unknown as Window & { __revlineRemotionText: typeof text };
host.__revlineRemotionText = text;
export { text };
