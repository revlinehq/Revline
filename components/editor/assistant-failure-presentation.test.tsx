import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {AssistantPanel} from './assistant-panel';
import type {ChatMessage} from './assistant-results';

const conflict='[CONVEX M(assistantEdits:apply)] [Request ID: private-id] Server Error\nUncaught ConvexError: The timeline changed elsewhere. Your pending replacement was not saved.\n    at handler (convex/assistantEdits.ts:115:9)';
const messages:ChatMessage[]=[
  {id:'request',role:'user',text:'Trim the pauses.'},
  {id:'answer',role:'assistant',text:'I’ll keep complete sentences.',steps:[
    {id:'saved',name:'trim',state:'done',output:{saved:true,revision:9,changedClips:[{id:'kept'}]}},
    {id:'staged',name:'delete',state:'done',staged:true,output:{saved:false,staged:true,revision:10,removedClipIds:['pause']}},
    {id:'failed-1',name:'trim',state:'error',detail:conflict},
    {id:'failed-2',name:'inspectTimeline',state:'error',detail:conflict},
  ]},
  {id:'failure-summary',role:'assistant',text:'No timeline changes were saved. A tool could not complete. Your pending replacement was not saved.'},
  {id:'receipt',role:'assistant',text:'Your pending replacement was not saved.',publicationReceipt:{version:1,kind:'timeline-publication',status:'failed',runId:'run',threadId:'thread',promptMessageId:'request',stagedRevision:10}},
];
function render(replies=messages,error:string|null=conflict){return renderToStaticMarkup(<AssistantPanel messages={replies} running={false} configured hasClips demo={false} error={error} onSend={async()=>{}}/>);}

test('one failed turn shows one actionable failure without duplicate receipts or backend diagnostics',()=>{
  const html=render();
  expect(html.match(/role="alert"/g)).toHaveLength(1);
  expect(html.replace(/<[^>]*>/g,'')).toContain('I’ll keep complete sentences.');
  expect(html).toContain('Trimmed 1 clip');
  expect(html).toMatch(/timeline changed/i);
  expect(html).toMatch(/not saved|unsaved/i);
  expect(html).not.toMatch(/CONVEX|ConvexError|Request ID|assistantEdits|at handler|Save not confirmed|No timeline changes were saved|Your pending replacement was not saved\./);
});

test('historical failed turns remain clear after reload without the live error prop',()=>{
  const html=render(messages,null);
  expect(html.match(/role="alert"/g)).toHaveLength(1);
  expect(html).not.toMatch(/ConvexError|at handler|Save not confirmed/);
  expect(html).toContain('Trimmed 1 clip');
});


test('unknown transport errors are hidden and genuine explanations and saved confirmations stay visible',()=>{
  const replies:ChatMessage[]=[{id:'request',role:'user',text:'Add captions.'},{id:'answer',role:'assistant',text:'The background job is still running. Your audio is already prepared.',steps:[{id:'failed',name:'analyzeMedia',state:'error',detail:'Uncaught ConvexError: internal request failed\n    at run (convex/private.ts:12:4)'}]}];
  const html=render(replies,null);
  expect(html.match(/role="alert"/g)).toHaveLength(1);
  expect(html.replace(/<[^>]*>/g,'')).toContain('The background job is still running. Your audio is already prepared.');
  expect(html).not.toMatch(/ConvexError|internal request|private.ts/);
  expect(html).toContain('Your saved edits remain.');
});

test('known clip-overlap rejection keeps the cause clear without exposing the internal error class',()=>{
  const html=render([{id:'request',role:'user',text:'Move this clip.'},{id:'answer',role:'assistant',text:'I’ll move it.',steps:[{id:'overlap',name:'moveClips',state:'error',detail:'TimelineGestureRejection: Overlaps a clip'}]}],null);
  expect(html.match(/role="alert"/g)).toHaveLength(1);
  expect(html).toContain('These clips would overlap.');
  expect(html).toContain('This edit was not saved');
  expect(html).toContain('previously saved edits remain');
  expect(html).not.toContain('TimelineGestureRejection');
});

test('captured partial styling preserves eight saves and explains unfinished work without generic errors', () => {
  const replies: ChatMessage[] = [{ id: 'request', role: 'user', text: 'Remove the boxes and use sentence-case outlined text.' }, { id: 'answer', role: 'assistant', text: 'I’ll restyle the labels.', steps: Array.from({ length: 8 }, (_, index) => ({ id: `saved-${index}`, name: index % 2 ? 'setTextStyle' : 'styleTextClip', state: 'done' as const, output: { saved: true, staged: false, revision: 28 + index, changedClips: [{ id: `title-${Math.floor(index / 2)}` }] } })) }, { id: 'summary', role: 'assistant', text: '8 edits were saved before the assistant stopped. Undo restores the state before the latest consecutive group of AI edits. The assistant stopped before finishing this request. The pending replacement was not saved.' }];
  const html = render(replies, 'An error occurred');
  expect(html).toContain('8 changes were saved');
  expect(html).toMatch(/request did not finish|unfinished|step limit/);
  expect(html).not.toMatch(/An error occurred|pending replacement|No timeline changes were saved/);
  expect(html.match(/role="alert"/g)).toHaveLength(1);
});
