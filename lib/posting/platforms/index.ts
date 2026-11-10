import type { PlatformAdapter, PostingPlatform } from '../adapter';
import { instagram } from './instagram';
import { tiktok } from './tiktok';
import { youtube } from './youtube';

// Each platform adds one line here. A platform without an adapter reads "Coming soon".
export const adapters: Partial<Record<PostingPlatform, PlatformAdapter>> = { instagram, tiktok, youtube };
