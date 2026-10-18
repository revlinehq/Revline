import { expect, test } from 'vitest';
import { hasRepeatedToolFailures, hasUnresolvedToolFailures } from './tool-failures';
import { moveSelectedClips } from '../editor/timeline-controls';
const call = (id:string,assetId='source') => ({type:'tool-call',toolCallId:id,toolName:'addMedia',input:{assetId,start:0}});
const error = (id:string) => ({type:'tool-error',toolCallId:id,toolName:'addMedia'});
const result = (id:string) => ({type:'tool-result',toolCallId:id,toolName:'addMedia',output:{saved:true}});
test('an error followed by a successful retry of the same input is resolved',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),error('first')]},{content:[call('retry'),result('retry')]}])).toBe(false));
test('success on a different command does not conceal an unresolved error',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),error('first')]},{content:[call('different','other'),result('different')]}])).toBe(true));
test('returned analysis failure remains unresolved until the same request succeeds',()=>expect(hasUnresolvedToolFailures([{content:[call('first'),{...result('first'),output:{success:false,error:'Unavailable'}}]}])).toBe(true));

const failed = (id: string) => ({ content: [call(id), error(id)] });
test('three failed attempts of one command stop the loop despite new call IDs', () => {
  const steps = [failed('one'), failed('two'), failed('three')];
  expect(hasRepeatedToolFailures(steps.slice(0, 2))).toBe(false);
  expect(hasRepeatedToolFailures(steps.slice(0, 2))).toBe(false);
  expect(hasRepeatedToolFailures(steps)).toBe(true);
  // The SDK evaluates stop conditions more than once for the same steps.
  expect(hasRepeatedToolFailures(steps)).toBe(true);
});

test('only a successful retry of that exact command resets its failure count', () => {
  const failures = [failed('one'), failed('two')];
  const unrelated = { content: [call('other', 'different'), result('other')] };
  expect(hasRepeatedToolFailures([...failures, unrelated, failed('three')])).toBe(true);
  const repaired = [...failures, { content: [call('repair'), result('repair')] }, failed('new-one'), failed('new-two')];
  expect(hasRepeatedToolFailures(repaired)).toBe(false);
  expect(hasRepeatedToolFailures([...repaired, failed('new-three')])).toBe(true);
});

test('command identity sorts nested object keys but preserves tool name and array order', () => {
  const failure = (id: string, toolName: string, input: unknown) => ({ content: [{ type: 'tool-error', toolCallId: id, toolName, input }] });
  const first = failure('one', 'configure', { clipId: 'source', changes: { amount: .5, center: [1, 2] } });
  const second = failure('two', 'configure', { changes: { center: [1, 2], amount: .5 }, clipId: 'source' });
  expect(hasRepeatedToolFailures([first, second, failure('three', 'configure', first.content[0].input)])).toBe(true);
  expect(hasRepeatedToolFailures([first, second, failure('different-tool', 'inspect', first.content[0].input)])).toBe(false);
  expect(hasRepeatedToolFailures([first, second, failure('different-array', 'configure', { clipId: 'source', changes: { amount: .5, center: [2, 1] } })])).toBe(false);
});

test('returned analysis failures count alongside thrown tool errors and are reset by real success', () => {
  const analysis = (id: string, success: boolean) => ({ content: [{ type: 'tool-result', toolCallId: id, toolName: 'inspectVideo', input: { assetId: 'source', question: 'Find the impact' }, output: { success } }] });
  const steps = [analysis('one', false), analysis('two', false), analysis('three', false)];
  expect(hasRepeatedToolFailures(steps)).toBe(true);
  expect(hasRepeatedToolFailures([...steps.slice(0, 2), { content: [{ type: 'tool-error', toolName: 'inspectVideo', toolCallId: 'third-error', input: steps[0].content[0].input }] }])).toBe(true);
  expect(hasRepeatedToolFailures([...steps, analysis('repair', true)])).toBe(false);
});

function rejectedMove() {
  try { moveSelectedClips({ fps: 30, aspectRatio: 'landscape', clips: [
    { id: 'waiting', kind: 'video', track: 1, start: 4.933333333333334, duration: .875, sourceStart: 16.5 },
    { id: 'tail-a', kind: 'video', track: 1, start: 10.333333333333334, duration: 5.233333333333333, sourceStart: 48.53333333333333 },
    { id: 'tail-b', kind: 'video', track: 1, start: 15.566666666666666, duration: 27, sourceStart: 59 },
  ] }, ['tail-a', 'tail-b'], -4.525, 0); } catch (error) { return error; }
  throw new Error('The recorded overlap must reproduce before testing recovery.');
}
const rejected = () => ({ content: [{ type: 'tool-error', toolCallId: 'rejected', toolName: 'moveClips', input: { clipIds: ['tail-a','tail-b'], timeDelta: -4.525 }, error: rejectedMove() }] });
const repaired = (patch = {}) => ({ content: [{ type: 'tool-result', toolCallId: 'repaired', toolName: 'moveClips', input: { clipIds: ['tail-a','tail-b'], timeDelta: -4.5, ...patch }, output: { staged: true, saved: false, changedClips: [{ id: 'tail-a' }, { id: 'tail-b' }] } }] });
const inspected = { content: [{ type: 'tool-result', toolCallId: 'checked', toolName: 'inspectTimeline', input: {}, output: { staged: true, revision: 16, summary: { overlapCount: 0, missingAssetRefs: [] } } }] };

test('a real rejected -4.525s placement is superseded by its same-target -4.5s correction after inspection', () => {
  expect(hasUnresolvedToolFailures([rejected(), repaired()])).toBe(true);
  expect(hasUnresolvedToolFailures([rejected(), repaired(), inspected])).toBe(false);
});

test('placement recovery cannot conceal another target, axis, layer change, error type or failed analysis', () => {
  for (const patch of [{ clipIds: ['other'] }, { timeDelta: undefined, layerDelta: 1 }, { layerDelta: 1 }]) expect(hasUnresolvedToolFailures([rejected(), repaired(patch), inspected])).toBe(true);
  const unknown = rejected(); unknown.content[0].error = new Error('Overlaps a clip');
  expect(hasUnresolvedToolFailures([unknown, repaired(), inspected])).toBe(true);
  expect(hasUnresolvedToolFailures([rejected(), { content: [{ type: 'tool-result', toolCallId: 'analysis', toolName: 'inspectFrames', input: { assetId: 'source', start: 0, end: 1, question: 'Look here' }, output: { success: false } }] }, repaired(), inspected])).toBe(true);
  expect(hasRepeatedToolFailures([rejected(), rejected(), rejected(), repaired(), inspected])).toBe(true);
});


test('recovery requires changed-target receipts and a subsequent successful clean inspection', () => {
  const noReceipt = repaired(); noReceipt.content[0].output.changedClips = [{ id: 'tail-a' }];
  expect(hasUnresolvedToolFailures([rejected(), noReceipt, inspected])).toBe(true);
  expect(hasUnresolvedToolFailures([rejected(), inspected, repaired()])).toBe(true);
  const invalidInspection = { content: [{ ...inspected.content[0], output: { ...inspected.content[0].output, summary: { overlapCount: 1, missingAssetRefs: [] } } }] };
  expect(hasUnresolvedToolFailures([rejected(), repaired(), invalidInspection])).toBe(true);
  const wrapped = (step: ReturnType<typeof repaired> | typeof inspected) => ({ content: step.content.map(part => ({ ...part, output: { type: 'json', value: part.output } })) });
  expect(hasUnresolvedToolFailures([rejected(), wrapped(repaired()), wrapped(inspected)])).toBe(false);
});
