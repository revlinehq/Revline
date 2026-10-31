'use client';
import { useMemo } from 'react';
import { useQueries, type RequestForQueries } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import type { FunctionArgs } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import { sceneThumbKey } from './scene-thumb-key';
import type { Timeline } from './types';

export type SceneThumbs = Record<string, { time: number; image: string }[]>;
type Name = 'forClips' | 'forShare';

/** Scene frames are decoration: a failing frames query (an older backend, a read limit) shows no frames instead of crashing the page. */
export function useSceneThumbs<N extends Name>(name: N, args: FunctionArgs<(typeof api.sceneThumbs)[N]> | 'skip'): SceneThumbs | undefined {
  const key = args === 'skip' ? '' : JSON.stringify(args);
  // useQueries needs the same object while the arguments are the same, or it re-subscribes on every render.
  const queries = useMemo((): RequestForQueries => key ? { thumbs: { query: makeFunctionReference<'query'>(`sceneThumbs:${name}`), args: JSON.parse(key) } } : {}, [name, key]);
  const result = useQueries(queries).thumbs;
  return result instanceof Error ? undefined : result as SceneThumbs | undefined;
}

const NONE: string[] = [];
type ClipFrames = { frames: SceneThumbs[string] | null; current: boolean; rendering: boolean };
/** Frames for each motion clip of the stored timeline, one subscription per clip keyed by what its frames depend on:
 *  an edit re-reads only the clips it changed, never the project or other clips' images.
 *  `missing` lists clips with no current frames and no render under way, for sceneThumbs.ensure. */
export function useClipSceneThumbs(projectId: string, timeline: Timeline | undefined) {
  const keys = useMemo(() => timeline ? timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene).map(clip => [clip.id, sceneThumbKey(clip, timeline)] as const) : [], [timeline]);
  const signature = keys.map(([, key]) => key).join('|');
  const queries = useMemo((): RequestForQueries => Object.fromEntries(keys.map(([clipId, key]) => [key, { query: makeFunctionReference<'query'>('sceneThumbs:forClip'), args: { projectId, clipId, key } }])), [projectId, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useQueries(queries);
  return useMemo(() => {
    const thumbs: SceneThumbs = {}, rendering: string[] = [], missing: string[] = [];
    let loaded = true;
    for (const [clipId, key] of keys) {
      const result = results[key] as ClipFrames | Error | undefined;
      if (result === undefined) { loaded = false; continue; }
      if (result instanceof Error) continue;
      if (result.frames) thumbs[clipId] = result.frames;
      if (result.rendering) rendering.push(clipId);
      else if (!result.current) missing.push(clipId);
    }
    return { thumbs: loaded || Object.keys(thumbs).length ? thumbs : undefined, rendering: rendering.length ? rendering : NONE, missing };
  }, [results, keys]);
}
