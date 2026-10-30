'use client';
import { useMemo } from 'react';
import { useQueries } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import type { FunctionArgs } from 'convex/server';
import type { api } from '@/convex/_generated/api';

export type SceneThumbs = Record<string, { time: number; image: string }[]>;
type Name = 'forProject' | 'forClips' | 'forShare';

/** Scene frames are decoration: a failing frames query (an older backend, a read limit) shows no frames instead of crashing the page. */
export function useSceneThumbs<N extends Name>(name: N, args: FunctionArgs<(typeof api.sceneThumbs)[N]> | 'skip'): SceneThumbs | undefined {
  const key = args === 'skip' ? '' : JSON.stringify(args);
  // useQueries needs the same object while the arguments are the same, or it re-subscribes on every render.
  const queries = useMemo(() => key ? { thumbs: { query: makeFunctionReference<'query'>(`sceneThumbs:${name}`), args: JSON.parse(key) } } : {}, [name, key]);
  const result = useQueries(queries).thumbs;
  return result instanceof Error ? undefined : result as SceneThumbs | undefined;
}
