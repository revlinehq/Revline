import { expect, test } from 'vitest';
import { chatMessageKey, chatMessageFromUI, chatToolFromPart, publicationReceiptFromPart, turnPublicationReceipt, summarizeTools, savedEditComparison, matchesUndoSnapshot, type ChatTool, type TimelinePublicationReceipt } from './assistant-results';
import { createEditorStore } from '@/lib/editor/store';
import type { Timeline } from '@/lib/editor/types';

test('stream and persisted SDK records retain the same React identity', () => {
  expect(chatMessageKey({ id: 'stream-123', key: 'thread-1-0' })).toBe(chatMessageKey({ id: 'stored-456', key: 'thread-1-0' }));
});
test.each([
  { state: 'output-error', errorText: 'Failed to save' },
  { state: 'output-available', output: { type: 'error-text', value: 'Shot detection failed' } },
  { state: 'output-available', output: { type: 'error-json', value: { message: 'Failed' } } },
  { state: 'output-available', output: 'Shot detection did not inspect the complete video.' },
  { state: 'output-available', output: { error: 'Cannot complete' } },
  { state: 'output-denied' },
])('tool failure is never presented as done: %o', part => {
  expect(chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'call', ...part })?.state).toBe('error');
});
test('successful inspection is quiet but failure stays visible', () => {
  const successful = chatToolFromPart({ type: 'tool-inspectTimeline', state: 'output-available', output: { revision: 2, timeline: { clips: [] } } })!;
  expect(summarizeTools([successful])).toEqual([]);
  expect(summarizeTools([{ ...successful, state: 'error', detail: 'Unavailable' }])[0]).toMatchObject({ state: 'error', detail: 'Unavailable' });
});
test('result cards use saved evidence, deduplicate tool calls and keep staged edits separate', () => {
  const beat: ChatTool = { id: 'beat', name: 'markMusicBeats', state: 'done', output: { added: 23, saved: true } };
  const steps: ChatTool[] = [beat, beat, { name: 'delete', state: 'done', staged: true, output: { removedClipIds: ['v1', 'a1'], saved: false } }, { name: 'addSubtitlesFromTranscript', state: 'done', output: { changedClips: [{ id: 'c1', kind: 'caption' }, { id: 'c2', kind: 'caption' }], saved: true } }];
  expect(summarizeTools(steps).map(card => card.title)).toEqual(['Marked 23 beats', 'Prepared: Removed 2 clips', 'Added 2 subtitles']);
  expect(summarizeTools(steps)[1].detail).toBe('Awaiting save');
});
test('low confidence or unchanged outputs do not claim edits happened', () => {
  expect(summarizeTools([{ name: 'markMusicBeats', state: 'done', output: { added: 0, status: 'low-confidence', unchanged: true } }])[0]).toMatchObject({ title: 'No new beat markers', detail: 'Beat detection has low confidence' });
  expect(summarizeTools([{ name: 'trim', state: 'done', output: { unchanged: true } }])[0].title).toBe('No changes needed');
});
test('only explicit save evidence permits a completed change card', () => {
  for (const output of [{ changedClips: [{ id: 'v1' }] }, { saved: false, changedClips: [{ id: 'v1' }] }]) {
    expect(summarizeTools([{ name: 'trim', state: 'done', output }])[0]).toMatchObject({ title: 'Save not confirmed', state: 'error' });
  }
  const staged = chatToolFromPart({ type: 'tool-delete', state: 'output-available', output: { staged: true, saved: false, removedClipIds: ['v1'] } })!;
  expect(summarizeTools([staged])[0]).toMatchObject({ title: 'Prepared: Removed 1 clip', detail: 'Awaiting save', staged: true });
});
test('missing counters are not reported as zero and only actual caption IDs count', () => {
  expect(summarizeTools([{ name: 'markMusicBeats', state: 'done', output: { saved: true } }])[0].title).toBe('Marked beats');
  expect(summarizeTools([{ name: 'delete', state: 'done', output: { saved: true } }])[0].title).toBe('Removed clips');
  expect(summarizeTools([{ name: 'addSubtitlesFromTranscript', state: 'done', output: { saved: true, changedClips: [{ kind: 'caption' }, { id: '', kind: 'caption' }, { id: 'c1', kind: 'caption' }, { id: 'c1', kind: 'caption' }, { id: 'v1', kind: 'video' }] } }])[0].title).toBe('Added 1 subtitle');
});
test('each failed tool remains visible and structured error messages are retained', () => {
  const first = chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'first', state: 'output-available', output: { type: 'error-json', value: { message: 'Transcription failed' } } })!;
  const second = chatToolFromPart({ type: 'tool-analyzeMedia', toolCallId: 'second', state: 'output-error', errorText: 'Shot detection failed' })!;
  expect(summarizeTools([first, second]).map(card => card.detail)).toEqual(['Transcription failed', 'Shot detection failed']);
});

test('marker removal reports unique removed IDs rather than requested counts or labels', () => {
  const one: ChatTool = { id: 'one', name: 'removeMarker', state: 'done', output: { saved: true, removed: 100, removedMarkerIds: ['unlabelled'] } };
  const some: ChatTool = { name: 'removeMarkers', state: 'done', output: { saved: true, removedMarkerIds: ['beat-1', 'beat-1', 'beat-2'] } };
  expect(summarizeTools([one, one, some]).map(card => card.title)).toEqual(['Removed 1 marker', 'Removed 2 markers']);
  expect(summarizeTools([{ ...some, output: { saved: true } }])[0].title).toBe('Removed markers');
});

test('marker removal no-ops and unconfirmed or staged deletions are reported honestly', () => {
  expect(summarizeTools([{ name: 'removeMarkers', state: 'done', output: { unchanged: true, saved: false, removed: 0, removedMarkerIds: [] } }])[0].title).toBe('No markers removed');
  expect(summarizeTools([{ name: 'removeMarkers', state: 'done', output: { saved: false, removedMarkerIds: ['beat'] } }])[0]).toMatchObject({ title: 'Save not confirmed', state: 'error' });
  expect(summarizeTools([{ name: 'removeMarker', state: 'done', output: { staged: true, saved: false, removedMarkerIds: ['beat'] } }])[0]).toMatchObject({ title: 'Prepared: Removed 1 marker', detail: 'Awaiting save', staged: true });
});

test('a real saved revision publishes a staged report without changing stored tool evidence',()=>{
  const before:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0},clips:[{id:'v',kind:'video',assetId:'source',start:0,duration:12,sourceStart:0}]};
  const after={...before,clips:[{...before.clips[0],duration:10}]};
  const steps:ChatTool[]=[{name:'delete',state:'done',staged:true,output:{staged:true,saved:false,revision:10,removedClipIds:['pause']}}];
  const snapshot={before,after,revision:11,canUndo:true,publishedDraft:true};
  const comparison=savedEditComparison(steps,snapshot)!;
  expect(comparison).toMatchObject({before,after,publishedRevision:11});
  expect(summarizeTools(steps,{publishedRevision:comparison.publishedRevision})[0]).toMatchObject({title:'Removed 1 clip',state:'done',staged:false});
  expect(summarizeTools(steps,{publishedRevision:comparison.publishedRevision,draftFailed:true})[0]).toMatchObject({title:'Removed 1 clip',state:'done',staged:false});
  expect(steps[0].output).toMatchObject({staged:true,saved:false});
  expect(savedEditComparison(steps,{...snapshot,publishedDraft:false})).toBeNull();
  expect(savedEditComparison(steps,{...snapshot,revision:12})).toBeNull();
  expect(summarizeTools(steps,{draftFailed:true})[0]).toMatchObject({title:'Not saved: Removed 1 clip',state:'error'});
});

test('comparison and Undo require the saved revision and the actual latest undo snapshot',()=>{
  const before:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'caption',kind:'caption',start:0,duration:3,sourceStart:0,text:'Before'}],tracks:{visual:1,overlay:0,audio:0}};
  const after={...before,clips:[{...before.clips[0],text:'After'}]};
  const snapshot={before,after,revision:4,canUndo:true,publishedDraft:false};
  expect(savedEditComparison([{name:'editText',state:'done',output:{saved:true,revision:3}}],snapshot)).toBeNull();
  expect(savedEditComparison([{name:'editText',state:'done',output:{saved:true,revision:4}}],snapshot)?.after).toEqual(after);
  const store=createEditorStore(before);store.getState().edit(after);
  expect(matchesUndoSnapshot(snapshot,store.getState().timeline,store.getState().history.at(-1))).toBe(true);
  store.getState().edit({...after,clips:[{...after.clips[0],fontSize:84}]});
  expect(matchesUndoSnapshot(snapshot,store.getState().timeline,store.getState().history.at(-1))).toBe(false);
  store.getState().undo();expect(matchesUndoSnapshot(snapshot,store.getState().timeline,store.getState().history.at(-1))).toBe(true);
  expect(store.getState().undo()).toEqual(before);
});

const receipt:TimelinePublicationReceipt={version:1,kind:'timeline-publication',status:'saved',runId:'run',threadId:'thread',promptMessageId:'raw-user',stagedRevision:10,revision:11};
const receiptPart=(publicationReceipt:unknown)=>({type:'text',text:'Your replacement edit is saved.',providerMetadata:{revline:{publicationReceipt}}});
test('SDK conversion preserves the durable receipt and raw prompt ID beside the streamed React key',()=>{
  const request=chatMessageFromUI({id:'raw-user',key:'thread-1-0',threadId:'thread',role:'user',parts:[{type:'text',text:'Remove both'}]});
  const reply=chatMessageFromUI({id:'raw-answer',key:'thread-1-1',threadId:'thread',role:'assistant',parts:[{type:'tool-delete',state:'output-available',output:{staged:true,saved:false,revision:10,removedClipIds:['a','b']}},receiptPart(receipt)]});
  expect(request).toMatchObject({id:'thread-1-0',sourceId:'raw-user'});
  expect(turnPublicationReceipt([request,reply])).toEqual(receipt);
  expect(summarizeTools(reply.steps!,{publicationReceipt:turnPublicationReceipt([request,reply])})).toMatchObject([{title:'Removed 2 clips',state:'done',staged:false}]);
  expect(turnPublicationReceipt([reply])).toEqual(receipt); // A page may begin after the user record.
  expect(turnPublicationReceipt([{...request,sourceId:'another-user'},reply])).toBeUndefined();
  expect(turnPublicationReceipt([request,{...reply,threadId:'another-thread'}])).toBeUndefined();
});
test('prose, success status, unsupported receipts and invalid revision proofs never imply publication',()=>{
  expect(publicationReceiptFromPart({type:'text',text:JSON.stringify(receipt)})).toBeUndefined();
  for(const patch of [{version:2},{kind:'other'},{status:'success'},{status:{}},{promptMessageId:''},{stagedRevision:-1},{stagedRevision:10.5},{revision:12},{revision:undefined}])expect(publicationReceiptFromPart(receiptPart({...receipt,...patch}))).toBeUndefined();
  const steps:ChatTool[]=[{name:'delete',state:'done',staged:true,output:{staged:true,saved:false,revision:10,removedClipIds:['a','b']}}];
  expect(summarizeTools(steps,{draftPending:false})).toMatchObject([{title:'Save not confirmed',state:'error'}]);
  expect(summarizeTools(steps,{draftPending:true})).toMatchObject([{title:'Prepared: Removed 2 clips',detail:'Awaiting save'}]);
  expect(summarizeTools(steps,{publicationReceipt:{...receipt,stagedRevision:9,revision:10},draftPending:false})).toMatchObject([{title:'Save not confirmed',state:'error'}]);
});
test.each(['failed','aborted'] as const)('%s receipt applies only to that staged revision and leaves immediate saves completed',status=>{
  const failed:TimelinePublicationReceipt={version:1,kind:'timeline-publication',runId:receipt.runId,threadId:receipt.threadId,promptMessageId:receipt.promptMessageId,stagedRevision:receipt.stagedRevision,status};
  expect(publicationReceiptFromPart(receiptPart(failed))).toEqual(failed);
  const steps:ChatTool[]=[{name:'trim',state:'done',output:{saved:true,revision:9,changedClips:[{id:'kept'}]}},{name:'delete',state:'done',staged:true,output:{staged:true,saved:false,revision:10,removedClipIds:['a','b']}}];
  expect(summarizeTools(steps,{publicationReceipt:failed,draftPending:false})).toMatchObject([{title:'Trimmed 1 clip',state:'done'},{title:'Not saved: Removed 2 clips',state:'error'}]);
  expect(steps[1].output?.saved).toBe(false);
});

test.each([
  {name:'inspectClip',output:{clip:{id:'source',kind:'video'},revision:8,staged:false}},
  {name:'inspectClip',output:{clip:{id:'source',kind:'video'},revision:8,staged:true}},
  {name:'inspectFrames',output:{assetId:'source',frames:[{frameIndex:12,sourceTime:.4}],inspectedFrameCount:1}},
])('successful $name reads do not ask for save confirmation, but failures and real unsaved edits remain visible',({name,output})=>{
  const read=chatToolFromPart({type:`tool-${name}`,toolCallId:'read',state:'output-available',output})!;
  expect(summarizeTools([read],{draftPending:false})).toEqual([]);
  const mutation=chatToolFromPart({type:'tool-trim',toolCallId:'trim',state:'output-available',output:{saved:false,changedClips:[{id:'source'}]}})!;
  expect(summarizeTools([read,mutation],{draftPending:false})).toMatchObject([{title:'Save not confirmed',state:'error'}]);
  const failed=chatToolFromPart({type:`tool-${name}`,toolCallId:'failed-read',state:'output-error',errorText:'Footage inspection could not finish.'})!;
  expect(summarizeTools([failed])).toMatchObject([{title:'Could not finish this step',detail:'Footage inspection could not finish.',state:'error'}]);
});
