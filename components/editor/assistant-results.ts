import { normalizeTimeline, type Timeline } from '@/lib/editor/types';
import {assistantErrorDetail} from './assistant-turn-presentation';
import type { TimelinePublicationReceipt } from '@/lib/ai/publication-receipt';
import { unresolvedToolFailureIds } from '@/lib/ai/tool-failures';
import { READ_ONLY_TOOLS } from '@/lib/ai/read-only-tools';
import { SAVED_ELSEWHERE, hasSaveEvidence, toolSaveReceipt, needsSaveConfirmation } from '@/lib/ai/save-confirmation';
import { mediaErrorMessage } from '@/lib/media-analysis/errors';
import { toolBehavior } from '@/lib/ai/tool-definitions';
import type { ChatBlock, ChatMessage, ChatTool, ResultCard } from './chat-types';

const chatMessageKey = (message: { id: string; key?: string }) => message.key ?? message.id;
export type AssistantEditSnapshot = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedDraft:boolean };
export type SavedEditComparison = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedRevision?:number };
export function matchesUndoSnapshot(snapshot:Pick<AssistantEditSnapshot,'before'|'after'>,current:Timeline,previous?:Timeline){
  return !!previous&&JSON.stringify(normalizeTimeline(current))===JSON.stringify(normalizeTimeline(snapshot.after))&&JSON.stringify(normalizeTimeline(previous))===JSON.stringify(normalizeTimeline(snapshot.before));
}

/** A tool revision must match the saved snapshot before a turn can claim its difference. */
export function savedEditComparison(steps:ChatTool[],snapshot?:AssistantEditSnapshot):SavedEditComparison|null {
  if(!snapshot)return null;
  const done=steps.filter(step=>step.state==='done'&&(toolSaveReceipt(step.output)?.kind==='timeline'||needsSaveConfirmation(step.name)));
  const saved=done.flatMap(step=>step.output?.saved===true&&typeof step.output.revision==='number'?[step.output.revision]:[]);
  const staged=done.flatMap(step=>(step.staged||step.output?.staged===true)&&typeof step.output?.revision==='number'?[step.output.revision]:[]);
  const published=snapshot.publishedDraft&&staged.length>0&&Math.max(...staged)+1===snapshot.revision;
  if(!published&&(!saved.length||Math.max(...saved)!==snapshot.revision))return null;
  const before=normalizeTimeline(snapshot.before),after=normalizeTimeline(snapshot.after);
  if(JSON.stringify(before)===JSON.stringify(after))return null;
  return {before,after,revision:snapshot.revision,canUndo:snapshot.canUndo,...(published?{publishedRevision:snapshot.revision}:{})};
}

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Only the server's persisted provider metadata can confirm a replacement publication. */
function publicationReceiptFromPart(value:unknown):TimelinePublicationReceipt|undefined {
  const part=record(value),receipt=record(record(record(part?.providerMetadata)?.revline)?.publicationReceipt);
  if(part?.type!=='text'||!receipt||receipt.version!==1||receipt.kind!=='timeline-publication'||typeof receipt.status!=='string'||!['saved','failed','aborted'].includes(receipt.status))return;
  if(!['runId','threadId','promptMessageId'].every(key=>typeof receipt[key]==='string'&&receipt[key].length>0)||typeof receipt.stagedRevision!=='number'||!Number.isSafeInteger(receipt.stagedRevision)||receipt.stagedRevision<0)return;
  if(receipt.status==='saved'?(!Number.isSafeInteger(receipt.revision)||receipt.revision!==receipt.stagedRevision+1):receipt.revision!==undefined)return;
  const identity={version:1 as const,kind:'timeline-publication' as const,runId:String(receipt.runId),threadId:String(receipt.threadId),promptMessageId:String(receipt.promptMessageId),stagedRevision:receipt.stagedRevision};
  return receipt.status==='saved'?{...identity,status:'saved',revision:Number(receipt.revision)}:{...identity,status:receipt.status as 'failed'|'aborted'};
}

function latestPublicationReceipt(receipts: readonly TimelinePublicationReceipt[]): TimelinePublicationReceipt | undefined {
  const latest = receipts.at(-1);
  // A committed publication is final, even if older cleanup code appends a failure later.
  return latest && latest.status !== 'saved' ? receipts.findLast(receipt=>receipt.status==='saved'&&receipt.runId===latest.runId&&receipt.stagedRevision===latest.stagedRevision) ?? latest : latest;
}

/** Preserve the SDK's raw prompt identity alongside its stable streamed React key. */
export function chatMessageFromUI(message:{id:string;key?:string;threadId?:string;role:string;status?:string;turnState?:ChatMessage['turnState'];turnError?:string;turnResuming?:boolean;parts:readonly unknown[]}):ChatMessage {
  const publicationReceipt=latestPublicationReceipt(message.parts.flatMap(part=>{const receipt=publicationReceiptFromPart(part);return receipt?[receipt]:[];}));
  // Text and tool calls in the order the model produced them; adjacent tool calls form one group.
  const blocks:ChatBlock[]=[];
  for(const part of message.parts){
    const step=chatToolFromPart(part),last=blocks.at(-1);
    if(step){if(last?.type==='tools')last.steps.push(step);else blocks.push({type:'tools',steps:[step]});continue;}
    // Claude's summarized thinking, kept in order so the chat can fold it into a Thinking row.
    if(record(part)?.type==='reasoning'){const thought=String(record(part)?.text??'').trim();if(thought){if(last?.type==='thinking')last.text+=`\n\n${thought}`;else blocks.push({type:'thinking',text:thought});}continue;}
    const text=record(part)?.type==='text'?String(record(part)?.text??''):'';
    if(!text.trim())continue;
    if(last?.type==='text')last.text+=`\n\n${text}`;else blocks.push({type:'text',text});
  }
  return {turnError:message.turnError,turnResuming:message.turnResuming,turnState:message.turnState,id:chatMessageKey(message),sourceId:message.id,threadId:message.threadId,role:message.role,status:message.status,blocks,text:message.parts.filter(part=>record(part)?.type==='text').map(part=>String(record(part)?.text??'')).join('\n\n'),steps:message.parts.flatMap(part=>{const step=chatToolFromPart(part);return step?[step]:[];}),...(publicationReceipt?{publicationReceipt}:{})};
}

/** The receipt stays with its original request, including a paginated partial turn. */
export function turnPublicationReceipt(messages:readonly ChatMessage[]):TimelinePublicationReceipt|undefined {
  const request=messages.find(message=>message.role==='user');
  const receipts = messages.filter(message=>message.role==='assistant').flatMap(message=>{
    const receipt=message.publicationReceipt;
    return receipt&&(!request||receipt.promptMessageId===(request.sourceId??request.id))&&(!message.threadId||receipt.threadId===message.threadId)&&(!request?.threadId||receipt.threadId===request.threadId)?[receipt]:[];
  });
  return latestPublicationReceipt(receipts);
}
const errorMessage = (value: unknown) => typeof value === 'string' ? value : typeof record(value)?.message === 'string' ? String(record(value)!.message) : 'This step could not finish.';
function unpack(value: unknown): { output?: Record<string, unknown>; error?: string } {
  // Tools that return images (getFrames, compareScreen) store the model content: a list of text and image parts.
  if (Array.isArray(value)) {
    // Image-producing tools keep their JSON result in a text part before the images.
    const structured = value.flatMap(part => {
      const text = record(part);
      if (text?.type !== 'text' || typeof text.text !== 'string') return [];
      try { const parsed = JSON.parse(text.text); return record(parsed) ? [unpack(parsed)] : []; } catch { return []; }
    });
    return { output: { ...Object.assign({}, ...structured.map(part => part.output)), type: 'content', value }, ...(structured.find(part => part.error)?.error ? { error: structured.find(part => part.error)!.error } : {}) };
  }
  const wrapped = record(value);
  if (wrapped && (wrapped.type === 'error-text' || wrapped.type === 'error-json')) return { error: errorMessage(wrapped.value) };
  if (wrapped && (wrapped.type === 'json' || wrapped.type === 'text')) return unpack(wrapped.value);
  if (wrapped?.type === 'content' && Array.isArray(wrapped.value)) return unpack(wrapped.value);
  if (typeof value === 'string') {
    try { return unpack(JSON.parse(value)); } catch { return { error: value || 'This step could not finish.' }; }
  }
  if (wrapped?.error || wrapped?.isError === true || wrapped?.success === false) return { output: wrapped, error: errorMessage(wrapped.error ?? wrapped) };
  return { output: wrapped };
}

/** Stored Agent error-text results can arrive as output-available; that is not success. */
function chatToolFromPart(value: unknown): ChatTool | null {
  const part = record(value);
  if (!part || typeof part.type !== 'string' || !part.type.startsWith('tool-') || typeof part.state !== 'string') return null;
  const { output, error } = unpack(part.output);
  const failed = part.state === 'output-error' || part.state === 'output-denied' || !!part.errorText || !!error || (part.state === 'output-available' && !output);
  return { id: typeof part.toolCallId === 'string' ? part.toolCallId : undefined, name: part.type.slice(5), state: failed ? 'error' : part.state === 'output-available' ? 'done' : 'running', staged: output?.staged === true, ...(record(part.input)?{input:record(part.input)}:{}), output, ...(failed ? { detail: assistantErrorDetail(mediaErrorMessage(new Error(String(part.errorText || error || 'This step could not finish.')))).slice(0, 240) } : {}) };
}

/** What the agent is doing right now, from the newest part of its reply: a running tool (scene code is named while it is
 * being written), thinking, or writing the reply. */
export function liveActivity(replies: readonly ChatMessage[]): { label: string; detail?: string } {
  const blocks = replies.at(-1)?.blocks ?? [], last = blocks.at(-1);
  if (last?.type === 'thinking') return { label: 'Thinking' };
  if (last?.type === 'text') return { label: 'Writing the reply' };
  const step = last?.type === 'tools' ? last.steps.at(-1) : undefined;
  if (!step || step.state !== 'running') return { label: 'Working' };
  const title = typeof step.input?.title === 'string' ? step.input.title : undefined;
  if (step.name === 'addScene' || step.name === 'addScenes' || step.name === 'addFilm' || step.name === 'editScene' || step.name === 'patchScene') return { label: step.name === 'editScene' || step.name === 'patchScene' ? 'Changing scene code' : step.name === 'addFilm' ? 'Writing the film' : 'Writing scene code', ...(title ? { detail: title } : {}) };
  return { label: toolBehavior(step.name)?.label?.[0] ?? 'Running a step' };
}

/** Images a step returned (frames), from its raw output or the content sent to the model. */
export function toolImages(step: ChatTool): { label: string; src: string }[] {
  const output = step.output, base64 = (value: unknown): value is string => typeof value === 'string' && value.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(value.slice(0, 200));
  if (!output) return [];
  if (Array.isArray(output.images)) return output.images.flatMap(image => { const item = record(image); return item && base64(item.data) ? [{ label: typeof item.label === 'string' ? item.label : '', src: `data:${typeof item.mimeType === 'string' ? item.mimeType : 'image/jpeg'};base64,${item.data}` }] : []; });
  if (Array.isArray(output.frames)) return output.frames.flatMap(frame => { const item = record(frame); return item && base64(item.image) ? [{ label: typeof item.time === 'number' ? `${item.time}s` : '', src: `data:image/jpeg;base64,${item.image}` }] : []; });
  if (output.type === 'content' && Array.isArray(output.value)) {
    const images: { label: string; src: string }[] = []; let label = '';
    for (const part of output.value.map(record)) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.length < 80) label = part.text;
      // Small images stay inline; the agent moves large ones to file storage and keeps their URL.
      const data = record(part?.data), stored = typeof data?.url === 'string' && /^https:\/\//.test(data.url) ? data.url : undefined;
      if (part?.type === 'file' && data && (base64(data.data) || stored)) { images.push({ label, src: stored ?? `data:${typeof part.mediaType === 'string' ? part.mediaType : 'image/jpeg'};base64,${data.data}` }); label = ''; }
    }
    return images;
  }
  return [];
}

const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const noun = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;

/** Aggregate only successful tool evidence, with pending replacements kept distinct. */
export function summarizeTools(steps: ChatTool[], evidence:{publishedRevision?:number;draftFailed?:boolean;draftPending?:boolean;publicationReceipt?:TimelinePublicationReceipt}={}): ResultCard[] {
  const receipt=evidence.publicationReceipt;
  const published=(output?:Record<string,unknown>)=>output?.staged===true&&typeof output.revision==='number'&&(receipt?receipt.status==='saved'&&output.revision===receipt.stagedRevision&&receipt.revision===receipt.stagedRevision+1:output.revision+1===evidence.publishedRevision);
  const unique = new Map<string, ChatTool>();
  steps.forEach((step, index) => unique.set(step.id ?? `${step.name}-${index}`, step));
  const unresolved=unresolvedToolFailureIds([{content:[...unique].filter(([,step])=>step.state!=='running').map(([id,step])=>({type:step.state==='error'?'tool-error':'tool-result',toolCallId:id,toolName:step.name,input:step.input,output:step.output,error:step.detail}))}]);
  const groups = new Map<string, ChatTool[]>();
  for (const [id, step] of unique) {
    if((step.state==='error'||step.output?.success===false)&&!unresolved.has(id))continue;
    if (step.state === 'done' && READ_ONLY_TOOLS.has(step.name)) continue;
    const staged = (step.staged === true || step.output?.staged === true)&&!published(step.output);
    const savedEvidence = staged ? 'prepared' : toolSaveReceipt(step.output)?.status ?? (hasSaveEvidence(step.output) || published(step.output) ? 'saved' : 'completed');
    const kind = step.name === 'markMusicBeats' ? `-${step.output?.kind ?? 'beats'}` : '';
    const key = step.state === 'error' ? `${step.name}-error-${id}` : `${step.name}${kind}-${step.state}-${savedEvidence}`;
    groups.set(key, [...groups.get(key) ?? [], { ...step, staged }]);
  }
  return [...groups].map(([key, group]): ResultCard | null => {
    const step = group[0], name = toolBehavior(step.name)?.label ?? ['Working on your edit', 'Updated your edit'];
    const save = toolSaveReceipt(step.output);
    if (step.state === 'error') return { key, title: save?.status === 'failed' ? `Could not save: ${step.name}` : save?.status === 'saved' ? `Changes saved; ${step.name} could not finish` : `Could not finish: ${step.name}`, detail: save?.status === 'failed' ? assistantErrorDetail(save.message) : step.detail, state: step.state, saveFailed: save?.status === 'failed' };
    if (step.state === 'running') return { key, title: name[0], state: step.state };
    const outputs = group.map(item => item.output ?? {});
    if (save?.status === 'failed') return { key, title: `Could not save: ${step.name}`, detail: assistantErrorDetail(save.message), state: 'error', saveFailed: true };
    if (save?.status === 'queued') return { key, title: `Queued: ${step.name}`, detail: typeof step.output?.note === 'string' ? step.output.note : 'Processing will continue in the background.', state: 'done' };
    // Old results without a receipt cannot prove a failed write. Keep them in the tool history.
    if (!step.staged && !SAVED_ELSEWHERE.has(step.name) && !outputs.some(output => hasSaveEvidence(output) || published(output))) return null;
    const changed = outputs.flatMap(output => Array.isArray(output.changedClips) ? output.changedClips.map(record).filter(Boolean) as Record<string, unknown>[] : []);
    const changedIds = new Set(changed.map(clip => clip.id).filter(isId));
    const removedIds = new Set(outputs.flatMap(output => Array.isArray(output.removedClipIds) ? output.removedClipIds.filter(isId) : []));
    let title = name[1];
    if (step.name === 'markMusicBeats' && outputs.every(output => count(output.added) !== undefined)) {
      const added = outputs.reduce((total, output) => total + count(output.added)!, 0);
      const event = step.output?.kind === 'accents' ? 'hit' : step.output?.kind === 'downbeats' ? 'bar start' : step.output?.kind === 'dropCandidates' ? 'possible drop' : 'beat';
      title = added ? `Marked ${noun(added, event)}` : `No new ${event} markers`;
    } else if ((step.name === 'removeMarker' || step.name === 'removeMarkers') && outputs.every(output => Array.isArray(output.removedMarkerIds))) {
      const markerIds = new Set(outputs.flatMap(output => (output.removedMarkerIds as unknown[]).filter(isId)));
      title = markerIds.size ? `Removed ${noun(markerIds.size, 'marker')}` : 'No markers removed';
    } else if (step.name === 'delete' && outputs.every(output => Array.isArray(output.removedClipIds))) title = removedIds.size ? `Removed ${noun(removedIds.size, 'clip')}` : 'No clips removed';
    else if ((step.name === 'addSubtitlesFromTranscript' || step.name === 'addCaption') && outputs.every(output => Array.isArray(output.changedClips))) {
      const ids = new Set(changed.filter(clip => clip.kind === 'caption').map(clip => clip.id).filter(isId));
      title = ids.size ? `Added ${noun(ids.size, 'subtitle')}` : 'No subtitles added';
    } else if (step.name === 'trim' && changedIds.size) title = `Trimmed ${noun(changedIds.size, 'clip')}`;
    else if (step.name === 'move' && changedIds.size) title = `Arranged ${noun(changedIds.size, 'clip')}`;
    const unchanged = outputs.every(output => output.unchanged === true);
    if (unchanged && !['markMusicBeats', 'removeMarker', 'removeMarkers'].includes(step.name)) title = 'No changes needed';
    const lowConfidence = outputs.some(output => output.status === 'low-confidence');
    const draftFailed=receipt&&(receipt.status==='failed'||receipt.status==='aborted')&&outputs.some(output=>output.revision===receipt.stagedRevision);
    if(step.staged&&draftFailed)return {key,title:`Could not save: ${step.name}`,detail:'The replacement edit was not saved.',state:'error',staged:true,saveFailed:true};
    const detail = [step.staged ? 'Awaiting save' : undefined, lowConfidence ? 'Beat detection has low confidence' : undefined].filter(Boolean).join(' · ') || undefined;
    return { key, title: step.staged && !unchanged ? `Prepared: ${title}` : title, detail, state: step.state, staged: step.staged };
  }).filter((card): card is ResultCard => card !== null);
}
