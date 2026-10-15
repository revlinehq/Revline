import { expect, test } from 'vitest';
import { hasRepeatedToolFailures, hasUnresolvedToolFailures } from './tool-failures';
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
