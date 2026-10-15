import { expect, test } from 'vitest';
import type { SegmentationMaskRecord } from '@meta-sam/parser';
import { indexSubjectMasks, subjectMasksAt, trackedSubjectAt } from './subject-tools';

test('tracking interpolates measured centers and never invents a track before detection or past coverage', () => {
  const samples = [{ time: 1, x: .2, y: .4 }, { time: 1.5, x: .8, y: .6 }];
  expect(trackedSubjectAt(samples, 1.25)).toEqual({ x: .5, y: .5 });
  expect(trackedSubjectAt(samples, 1.8)).toMatchObject({ x: .8, y: .6 });
  for (const time of [0, 2.1, NaN, Infinity]) expect(trackedSubjectAt(samples, time)).toBeUndefined();
  expect(trackedSubjectAt([], 1)).toBeUndefined();
});

const mask = (identity: string, objectId: string, frameIndex?: number, revision = 1): SegmentationMaskRecord => ({ kind: 'mask', order: 0, identity, objectId, revision, ...(frameIndex === undefined ? {} : { frame: { frameIndex } }), bounds: { left: 0, top: 0, right: 2, bottom: 2 }, mask: { encoding: 'one_bit', width: 2, height: 2, payload: 'synthetic test record' } });
test('mask indexing selects exact frames, requested objects, and latest revisions in cumulative snapshots', () => {
  const first = mask('person:0', 'person', 0), revised = mask('person:0', 'person', 0, 2), second = mask('dog:0', 'dog', 0), later = mask('person:2', 'person', 2), global = mask('global', 'global');
  const index = indexSubjectMasks([first, revised, second, later, first, global]);
  expect(index.count).toBe(4); expect(index.objects).toEqual(['person', 'dog', 'global']);
  expect(subjectMasksAt(index, 0, 'person')).toEqual([revised]);
  expect(subjectMasksAt(index, 1, 'person')).toEqual([]);
  expect(subjectMasksAt(index, 2, 'person')).toEqual([later]);
  expect(subjectMasksAt(index, 1)).toEqual([global]);
  expect(subjectMasksAt(index, 0, 'missing')).toEqual([]);
});
