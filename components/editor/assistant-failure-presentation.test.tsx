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
