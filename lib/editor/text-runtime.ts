import * as text from './text-template-runtime';

// The text renderer's bundle; transitions have their own (transitions-bundle.ts).
const host = window as unknown as Window & { __revlineTextRuntime: typeof text };
host.__revlineTextRuntime = text;
export { text };
