import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {AssistantPanel} from './assistant-panel';
import type {ChatMessage} from './assistant-results';
import {assistantTurnPresentation} from './assistant-turn-presentation';

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

test('a recoverable rejected planning call is not a failed edit while the agent is running',()=>{
  const cards=[{key:'plan-error',title:'Could not finish this step',detail:'Error: Read the current cut before planning its effect.',state:'error' as const}];
  expect(assistantTurnPresentation([],cards,{active:true}).cards).toEqual([]);
  expect(assistantTurnPresentation([],cards).cards).toHaveLength(1);
  expect(assistantTurnPresentation([],cards,{active:true,error:'The request stopped.'}).cards).toHaveLength(1);
  const replies:ChatMessage[]=[{id:'request',role:'user',text:'Reduce rounding and crop the header.'},{id:'answer',role:'assistant',status:'pending',text:'I’ll reduce rounding and crop the header.',steps:[{id:'plan',name:'planEffects',state:'error',detail:cards[0].detail}]}];
  const html=renderToStaticMarkup(<AssistantPanel messages={replies} running configured hasClips demo={false} onSend={async()=>{}}/>);
  expect(html).not.toContain('role="alert"');
  expect(render(replies,null)).toContain('role="alert"');
});

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

test('a paginated running turn without its user record stays prepared instead of falsely unconfirmed', () => {
  const partial: ChatMessage[] = [{ id: 'thread-21-1', sourceId: 'raw-assistant', threadId: 'thread', role: 'assistant', status: 'streaming', text: 'I’ll finish the requested changes.', steps: [{ id: 'draft-trim', name: 'trim', state: 'done', staged: true, output: { staged: true, saved: false, revision: 67, changedClips: [{ id: 'clip' }] } }] }];
  const html = renderToStaticMarkup(<AssistantPanel messages={partial} running configured hasClips demo={false} onSend={async () => {}} />);
  expect(html).not.toMatch(/Save not confirmed|No saved confirmation|Could not finish this edit/);
  expect(html).not.toContain('role="alert"');
  expect(html).toContain('Prepared: Trimmed 1 clip');
});

test('pending streamed publication does not briefly fail when the run status arrives before its receipt', () => {
  const partial: ChatMessage[] = [{ id: 'answer', role: 'assistant', status: 'pending', text: '', steps: [{ name: 'trim', state: 'done', output: { staged: true, saved: false, revision: 67, changedClips: [{ id: 'clip' }] } }] }];
  const html = renderToStaticMarkup(<AssistantPanel messages={partial} running={false} configured hasClips demo={false} onSend={async () => {}} />);
  expect(html).not.toContain('Save not confirmed'); expect(html).toContain('Awaiting save');
});

test('completed assistant-only history without a receipt still reports unconfirmed edits honestly', () => {
  const partial: ChatMessage[] = [{ id: 'answer', role: 'assistant', status: 'success', text: 'Finished.', steps: [{ name: 'trim', state: 'done', output: { staged: true, saved: false, revision: 67, changedClips: [{ id: 'clip' }] } }] }];
  const html = renderToStaticMarkup(<AssistantPanel messages={partial} running={false} configured hasClips demo={false} onSend={async () => {}} />);
  expect(html).toContain('Save not confirmed'); expect(html).toContain('role="alert"');
});

test('unfinished edits offer one explicit continuation button, even after an explanatory reply',()=>{
  const replies:ChatMessage[]=[...messages,{id:'why',role:'user',text:'Why did it stop?'},{id:'explanation',role:'assistant',text:'The time limit interrupted the edit.'}];
  const html=renderToStaticMarkup(<AssistantPanel messages={replies} running={false} configured hasClips demo={false} canResumeEdit onSend={async()=>{}} onRetry={async()=>{}}/>);
  expect(html.match(/Retry unfinished steps/g)).toHaveLength(1);
  expect(html).not.toContain('>Retry</button>');
  const running=renderToStaticMarkup(<AssistantPanel messages={replies} running configured hasClips demo={false} canResumeEdit onSend={async()=>{}} onRetry={async()=>{}}/>);
  expect(running).not.toContain('Retry unfinished steps');
});


test('an unfinished footage inspection is labeled as a check, not an unsaved edit',()=>{
  const detail='Some footage checks could not complete. Your timeline was not changed.';
  const html=render([{id:'request',role:'user',text:'Detect gaze resets without editing.'},{id:'answer',role:'assistant',text:'Two resets were confirmed; the full cut remains unchecked.',steps:[{id:'inspection',name:'inspectVideo',state:'error',detail:'The media analysis request was rejected.'}]}],detail);
  expect(html).toContain('Footage check incomplete');
  expect(html).toContain('Your timeline was not changed.');
  expect(html).not.toContain('Could not finish this edit');
  expect(html).not.toContain('changes were not saved');
});


test('the generic incomplete request banner preserves trust in earlier saved edits',()=>{
  const html=render([{id:'request',role:'user',text:'Finish the captions.'},{id:'answer',role:'assistant',text:'The captions are saved.'}],'Some requested changes were not saved. Inspect the current timeline before continuing; previously saved edits remain.');
  expect(html).toContain('Some steps are unfinished');
  expect(html).toContain('Your saved edits are still here.');
  expect(html).not.toContain('Could not finish this edit');
  expect(html).not.toContain('Some requested changes were not saved');
});
