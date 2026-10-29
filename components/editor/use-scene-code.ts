import { useMemo } from 'react';
import { useQueries } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { sceneCodeRefs, withSceneCode } from '@/lib/editor/scene-code';
import type { Timeline } from '@/lib/editor/types';

type Clips = Pick<Timeline, 'clips'>;
export type RestoreSceneCode = <T extends Clips>(timeline: T) => T;

/** Stored timelines reference scene code by hash. Subscribe to each code once (it never changes, so
 * it stays cached across edits) and return a function that puts it back; null until all code loaded. */
export function useSceneCode(projectId: string, timelines: readonly (Clips | null | undefined)[]): RestoreSceneCode | null {
  const key = [...new Set(timelines.flatMap(timeline => timeline ? sceneCodeRefs(timeline) : []))].sort().join(',');
  const queries = useMemo(() => Object.fromEntries((key ? key.split(',') : []).map(hash => [hash, { query: api.projects.sceneCode, args: { projectId, hash } }])), [key, projectId]);
  const results = useQueries(queries);
  const ready = Object.keys(queries).every(hash => results[hash] !== undefined);
  // Code for a hash never changes, so the restore made when this set of hashes loaded stays valid.
  return useMemo(() => {
    if (!ready) return null;
    const code = (hash: string) => { const text = results[hash]; return typeof text === 'string' ? text : undefined; };
    // A missing row leaves that scene by hash; saving sends it back and the server restores it.
    return <T extends Clips>(timeline: T) => withSceneCode(timeline, code) ?? timeline;
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
