import { expect, test } from 'vitest';
import { parseVideoStream, decodeMaskToRaster } from '@meta-sam/parser';
import { samEvents } from './events';

function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
}
test('decodes split UTF-8 and CRLF events, ignores comments and DONE, and flushes an unterminated final event', async () => {
  const text = ': heartbeat\r\n\r\ndata: {"type":"response.output_text.delta","delta":"人物"}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"type":"response.completed"}';
  const events = [];
  for await (const event of samEvents(stream(text))) events.push(event);
  expect(events).toEqual([{ type: 'response.output_text.delta', delta: '人物' }, { type: 'response.completed' }]);
});
test('passes tracked frame records into the official video parser', async () => {
  const delta = { type: 'response.output_text.delta', item_id: 'm', output_index: 0, content_index: 0, delta: `<0f>0<|box;x1=1;y1=2;x2=7;y2=8;w=10;h=10|><|mask;x=0;y=0;data=6,6,!!!!!'y:9{m4D|>\n<1f>0<|box;x1=2;y1=3;x2=8;y2=9;w=10;h=10|><|mask;x=0;y=0;data=6,6,!!!!!'y:9{m4D|>\n` };
  const done={...delta,type:'response.output_text.done',text:delta.delta};
  const parsed = parseVideoStream(samEvents(stream(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(done)}\n\ndata: {"type":"response.completed"}\n\n`)));
  for await (const _ of parsed) { /* Consume the response fully. */ }
  const result = await parsed.finalResult;
  expect(result.outcome.status).toBe('completed');
  expect(result.diagnostics).toEqual([]);
  const masks=result.records.filter(record=>record.kind==='mask');
  expect(masks).toHaveLength(2);
  expect([...decodeMaskToRaster(masks[0].mask)]).toEqual(new Array(36).fill(1));
  expect(result.records.filter(record => record.kind === 'box').map(record => ({ objectId: record.objectId, frame: record.frame?.frameIndex }))).toEqual([{ objectId: '0', frame: 0 }, { objectId: '0', frame: 1 }]);
});
test('empty output is a completed zero-match result', async () => {
  const parsed = parseVideoStream(samEvents(stream('data: {"type":"response.output_text.done","item_id":"m","output_index":0,"content_index":0,"text":""}\n\ndata: {"type":"response.completed"}\n\n')));
  for await (const _ of parsed) {}
  expect((await parsed.finalResult).records).toEqual([]);
});
test('rejects malformed stream data rather than displaying invented masks', async () => {
  await expect(async () => { for await (const _ of samEvents(stream('data: {"delta":"broken"}\n\n'))) {} }).rejects.toThrow('unreadable stream');
});
