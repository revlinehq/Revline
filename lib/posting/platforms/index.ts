import type { PlatformAdapter, PostingPlatform } from '../adapter';

// Each platform adds one line here. A platform without an adapter reads "Coming soon".
export const adapters: Partial<Record<PostingPlatform, PlatformAdapter>> = {};
