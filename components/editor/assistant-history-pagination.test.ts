import { expect, test } from 'vitest';
import { AssistantHistoryExpansion } from './assistant-history-pagination';
const partial = (page: number) => [{ id: `assistant-prefix-${page}`, role: 'assistant' }];
test('expands a tool-heavy partial turn only when each new older page arrives', () => {
  const expansion = new AssistantHistoryExpansion();
  expect(expansion.next('thread', 'CanLoadMore', partial(40))).toBe(true);
  expect(expansion.next('thread', 'CanLoadMore', partial(40))).toBe(false);
  expect(expansion.next('thread', 'LoadingMore', partial(40))).toBe(false);
  expect(expansion.next('thread', 'CanLoadMore', partial(60))).toBe(true);
  const complete = [{ id: 'raw-prompt', role: 'user' }, ...partial(80)];
  expect(expansion.next('thread', 'CanLoadMore', complete)).toBe(false);
  expect(expansion.next('thread', 'CanLoadMore', complete)).toBe(false);
});
test('bounds expansion to three requests and resets only when the thread changes', () => {
  const expansion = new AssistantHistoryExpansion();
  expect([40,60,80,100,120].map(page=>expansion.next('thread','CanLoadMore',partial(page)))).toEqual([true,true,true,false,false]);
  expect(expansion.next('other-thread','CanLoadMore',partial(40))).toBe(true);
});
test('empty, exhausted and already complete pages never fetch more automatically', () => {
  const expansion = new AssistantHistoryExpansion();
  expect(expansion.next('thread','CanLoadMore',[])).toBe(false);
  expect(expansion.next('thread','Exhausted',partial(40))).toBe(false);
  expect(expansion.next('thread','CanLoadMore',[{id:'user',role:'user'}])).toBe(false);
});

test('official SDK conversion recovers the raw prompt after an 83-record tool turn using three pages', async () => {
  const { toUIMessages } = await import('@convex-dev/agent');
  const docs: Record<string, unknown>[] = [{ _id: 'raw-prompt', _creationTime: 1, threadId: 'thread', order: 21, stepOrder: 0, status: 'success', message: { role: 'user', content: 'Edit this clip.' } }];
  for (let call = 0; call < 41; call++) {
    docs.push({ _id: `assistant-${call}`, _creationTime: call*2+2, threadId: 'thread', order: 21, stepOrder: call*2+1, status: 'success', message: { role: 'assistant', content: [{ type: 'tool-call', toolName: 'trim', toolCallId: `call-${call}`, input: {} }] } });
    docs.push({ _id: `result-${call}`, _creationTime: call*2+3, threadId: 'thread', order: 21, stepOrder: call*2+2, status: 'success', message: { role: 'tool', content: [{ type: 'tool-result', toolName: 'trim', toolCallId: `call-${call}`, output: { type: 'json', value: { staged: true, saved: false, revision: 67 } } }] } });
  }
  const expansion = new AssistantHistoryExpansion();
  const decisions = [40,60,80,100].map(size => {
    const ui = toUIMessages(docs.slice(-size) as unknown as Parameters<typeof toUIMessages>[0]);
    const messages = ui.map(message => ({ id: message.key ?? message.id, role: message.role }));
    const request = expansion.next('thread', 'CanLoadMore', messages);
    expect(expansion.next('thread', 'CanLoadMore', messages)).toBe(false);
    return request;
  });
  expect(decisions).toEqual([true,true,true,false]);
});
