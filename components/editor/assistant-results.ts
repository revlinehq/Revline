import { normalizeTimeline, type Timeline } from '@/lib/editor/types';
import {assistantErrorDetail} from './assistant-turn-presentation';
import type { TimelinePublicationReceipt } from '@/lib/ai/publication-receipt';
import { unresolvedToolFailureIds } from '@/lib/ai/tool-failures';
import { READ_ONLY_TOOLS } from '@/lib/ai/read-only-tools';
export type { TimelinePublicationReceipt } from '@/lib/ai/publication-receipt';

export type ChatTool = { id?: string; name: string; state: 'running' | 'done' | 'error' | 'stopped'; detail?: string; staged?: boolean; input?: Record<string, unknown>; output?: Record<string, unknown> };
export type ChatBlock = { type:'text'; text:string } | { type:'tools'; steps:ChatTool[] } | { type:'thinking'; text:string };
export type ChatMessage = { id:string;sourceId?:string;threadId?:string;role:string;text:string;status?:string;tools?:string[];steps?:ChatTool[];blocks?:ChatBlock[];publicationReceipt?:TimelinePublicationReceipt };
export type ResultCard = { key: string; title: string; detail?: string; state: ChatTool['state']; staged?: boolean };
export const chatMessageKey = (message: { id: string; key?: string }) => message.key ?? message.id;
export type AssistantEditSnapshot = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedDraft:boolean };
export type SavedEditComparison = { before:Timeline;after:Timeline;revision:number;canUndo:boolean;publishedRevision?:number };
export function matchesUndoSnapshot(snapshot:Pick<AssistantEditSnapshot,'before'|'after'>,current:Timeline,previous?:Timeline){
  return !!previous&&JSON.stringify(normalizeTimeline(current))===JSON.stringify(normalizeTimeline(snapshot.after))&&JSON.stringify(normalizeTimeline(previous))===JSON.stringify(normalizeTimeline(snapshot.before));
}

/** A tool revision must match the saved snapshot before a turn can claim its difference. */
export function savedEditComparison(steps:ChatTool[],snapshot?:AssistantEditSnapshot):SavedEditComparison|null {
  if(!snapshot)return null;
  const done=steps.filter(step=>step.state==='done'&&!READ_ONLY_TOOLS.has(step.name));
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
export function publicationReceiptFromPart(value:unknown):TimelinePublicationReceipt|undefined {
  const part=record(value),receipt=record(record(record(part?.providerMetadata)?.revline)?.publicationReceipt);
  if(part?.type!=='text'||!receipt||receipt.version!==1||receipt.kind!=='timeline-publication'||typeof receipt.status!=='string'||!['saved','failed','aborted'].includes(receipt.status))return;
  if(!['runId','threadId','promptMessageId'].every(key=>typeof receipt[key]==='string'&&receipt[key].length>0)||typeof receipt.stagedRevision!=='number'||!Number.isSafeInteger(receipt.stagedRevision)||receipt.stagedRevision<0)return;
  if(receipt.status==='saved'?(!Number.isSafeInteger(receipt.revision)||receipt.revision!==receipt.stagedRevision+1):receipt.revision!==undefined)return;
  const identity={version:1 as const,kind:'timeline-publication' as const,runId:String(receipt.runId),threadId:String(receipt.threadId),promptMessageId:String(receipt.promptMessageId),stagedRevision:receipt.stagedRevision};
  return receipt.status==='saved'?{...identity,status:'saved',revision:Number(receipt.revision)}:{...identity,status:receipt.status as 'failed'|'aborted'};
}

/** Preserve the SDK's raw prompt identity alongside its stable streamed React key. */
export function chatMessageFromUI(message:{id:string;key?:string;threadId?:string;role:string;status?:string;parts:readonly unknown[]}):ChatMessage {
  const publicationReceipt=message.parts.flatMap(part=>{const receipt=publicationReceiptFromPart(part);return receipt?[receipt]:[];}).at(-1);
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
  return {id:chatMessageKey(message),sourceId:message.id,threadId:message.threadId,role:message.role,status:message.status,blocks,text:message.parts.filter(part=>record(part)?.type==='text').map(part=>String(record(part)?.text??'')).join('\n\n'),steps:message.parts.flatMap(part=>{const step=chatToolFromPart(part);return step?[step]:[];}),...(publicationReceipt?{publicationReceipt}:{})};
}

/** The receipt stays with its original request, including a paginated partial turn. */
export function turnPublicationReceipt(messages:readonly ChatMessage[]):TimelinePublicationReceipt|undefined {
  const request=messages.find(message=>message.role==='user');
  return messages.filter(message=>message.role==='assistant').flatMap(message=>{
    const receipt=message.publicationReceipt;
    return receipt&&(!request||receipt.promptMessageId===(request.sourceId??request.id))&&(!message.threadId||receipt.threadId===message.threadId)&&(!request?.threadId||receipt.threadId===request.threadId)?[receipt]:[];
  }).at(-1);
}
const errorMessage = (value: unknown) => typeof value === 'string' ? value : typeof record(value)?.message === 'string' ? String(record(value)!.message) : 'This step could not finish.';
function unpack(value: unknown): { output?: Record<string, unknown>; error?: string } {
  // Tools that return images (getFrames, compareScreen) store the model content: a list of text and image parts.
  if (Array.isArray(value)) return { output: { type: 'content', value } };
  const wrapped = record(value);
  if (wrapped && (wrapped.type === 'error-text' || wrapped.type === 'error-json')) return { error: errorMessage(wrapped.value) };
  if (wrapped && (wrapped.type === 'json' || wrapped.type === 'text')) return unpack(wrapped.value);
  if (typeof value === 'string') {
    try { return unpack(JSON.parse(value)); } catch { return { error: value || 'This step could not finish.' }; }
  }
  if (wrapped?.error || wrapped?.isError === true || wrapped?.success === false) return { error: errorMessage(wrapped.error ?? wrapped) };
  return { output: wrapped };
}

/** Stored Agent error-text results can arrive as output-available; that is not success. */
export function chatToolFromPart(value: unknown): ChatTool | null {
  const part = record(value);
  if (!part || typeof part.type !== 'string' || !part.type.startsWith('tool-') || typeof part.state !== 'string') return null;
  const { output, error } = unpack(part.output);
  const failed = part.state === 'output-error' || part.state === 'output-denied' || !!part.errorText || !!error || (part.state === 'output-available' && !output);
  return { id: typeof part.toolCallId === 'string' ? part.toolCallId : undefined, name: part.type.slice(5), state: failed ? 'error' : part.state === 'output-available' ? 'done' : 'running', staged: output?.staged === true, ...(record(part.input)?{input:record(part.input)}:{}), output, ...(failed ? { detail: assistantErrorDetail(String(part.errorText || error || 'This step could not finish.')).slice(0, 240) } : {}) };
}

/** What the agent is doing right now, from the newest part of its reply: a running tool (scene code is named while it is
 * being written), thinking, or writing the reply. */
export function liveActivity(replies: readonly ChatMessage[]): { label: string; detail?: string } {
  const blocks = replies.at(-1)?.blocks ?? [], last = blocks.at(-1);
  if (last?.type === 'thinking') return { label: 'Thinking' };
  if (last?.type === 'text') return { label: 'Writing the reply' };
  const step = last?.type === 'tools' ? last.steps.at(-1) : undefined;
  if (!step || step.state !== 'running') return { label: 'Thinking about the next step' };
  const title = typeof step.input?.title === 'string' ? step.input.title : undefined;
  if (step.name === 'addScene' || step.name === 'addScenes' || step.name === 'editScene') return { label: step.name === 'editScene' ? 'Changing scene code' : 'Writing scene code', ...(title ? { detail: title } : {}) };
  return { label: TOOL_LABELS[step.name]?.[0] ?? 'Running a step' };
}

/** Images a step returned (frames, blueprint renders and diffs), from its raw output or the content sent to the model. */
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

export const TOOL_LABELS: Record<string, [string, string]> = {
  setTextGradient: ['Styling gradient text', 'Styled gradient text'],
  configureSmoothZoom: ['Adding smooth zoom', 'Added smooth zoom'],
  configureCameraMotion: ['Adding camera motion', 'Added camera motion'],
  markMusicBeats: ['Marking beats', 'Marked beats'], removeMarker: ['Removing marker', 'Removed marker'], removeMarkers: ['Removing markers', 'Removed markers'], delete: ['Removing clips', 'Removed clips'], addSubtitlesFromTranscript: ['Adding subtitles', 'Added subtitles'],
  split: ['Splitting clips', 'Split clips'], trim: ['Trimming footage', 'Trimmed footage'], move: ['Arranging clips', 'Arranged clips'], addMedia: ['Adding footage', 'Added footage'],
  addCaption: ['Adding captions', 'Added captions'], addGraphic: ['Adding titles', 'Added titles'], editText: ['Updating text', 'Updated text'], styleCaptions: ['Styling captions', 'Styled captions'], styleTextClip: ['Styling text', 'Styled text'],
  applyTextLook: ['Applying text style', 'Styled text'], setTextStyle: ['Styling text', 'Styled text'], setTextAnimation: ['Animating text', 'Animated text'], configureTextTemplate: ['Adjusting text animation', 'Adjusted text animation'],
  setCaptionTiming: ['Adjusting subtitle timing', 'Adjusted subtitle timing'], applyCaptionStyle: ['Styling captions', 'Styled captions'], configureAudio: ['Adjusting sound', 'Adjusted sound'], configureVisualFade: ['Adjusting footage fades', 'Adjusted footage fades'],
  addClipTransition: ['Adding transition', 'Added transition'], configureClipTransition: ['Adjusting transition', 'Adjusted transition'], configureTimedEffect: ['Adjusting effect', 'Adjusted effect'], setSolidColor: ['Adjusting color rectangle', 'Adjusted color rectangle'], resetVisualEffect: ['Resetting effect', 'Reset effect'],
  addMarker: ['Adding marker', 'Added marker'], moveMarker: ['Moving marker', 'Moved marker'],
  undoLatestEdit: ['Reverting latest edit', 'Reverted latest edit'], unlink: ['Unlinking video and audio', 'Unlinked video and audio'], duplicateClips: ['Duplicating clips', 'Duplicated clips'],
  reorderLayer: ['Reordering track', 'Reordered track'], moveClips: ['Arranging clips', 'Arranged clips'], resizeClips: ['Trimming clips', 'Trimmed clips'], setBlendMode: ['Adjusting compositing', 'Adjusted compositing'],
  transformClip: ['Adjusting framing', 'Adjusted framing'], cropClip: ['Cropping footage', 'Cropped footage'], resetVisual: ['Resetting framing', 'Reset framing'], fitClip: ['Fitting footage', 'Fitted footage'],
  setVolume: ['Adjusting sound', 'Adjusted sound'], setAspectRatio: ['Resizing canvas', 'Resized canvas'], followSubject: ['Following subject', 'Applied subject tracking'], alignCutsToBeat: ['Matching cuts to beats', 'Matched cuts to beats'],
  addLayer: ['Adding track', 'Added track'], deleteEmptyLayer: ['Removing empty track', 'Removed empty track'], closeGaps: ['Closing gaps', 'Closed gaps'], cleanSpeech: ['Cleaning up speech', 'Cleaned up speech'], setSplitEdits: ['Adding J and L cuts', 'Added J and L cuts'], removeEmptyLayers: ['Removing empty tracks', 'Removed empty tracks'],
  useStrongestMoment: ['Choosing a moment', 'Added selected moment'], applyMotionPreset: ['Animating text', 'Animated text'], animateClip: ['Animating object', 'Animated object'], setVisualEffects: ['Adjusting visual effects', 'Adjusted visual effects'],
  setPlaybackRate: ['Changing speed', 'Changed speed'], applyTextTemplate: ['Animating text', 'Animated text'], addTimedEffect: ['Adding an effect', 'Added an effect'],
  planEffects:['Planning effects','Planned effects'],previewRender:['Reviewing rendered edit','Reviewed rendered samples'],
  readSkill: ['Reading editing guide', 'Read editing guide'], askUser: ['Asking you', 'Asked you'], askBrandKit: ['Asking which brand', 'Asked which brand'], measureScreen: ['Measuring screen', 'Measured screen'], readFrames: ['Reading frames', 'Read frames'], compareReference: ['Comparing with the reference', 'Compared with the reference'], trackReference: ['Tracking motion', 'Tracked motion'], measureFrame: ['Measuring frame', 'Measured frame'], compareScreen: ['Comparing with screen', 'Compared with screen'], saveBlueprint: ['Saving blueprint', 'Saved blueprint'], listBlueprints: ['Checking blueprints', 'Checked blueprints'], getBlueprint: ['Loading blueprint', 'Loaded blueprint'], createBrandKit: ['Building brand kit', 'Saved brand kit'], remember: ['Saving to memory', 'Saved to memory'], forget: ['Removing from memory', 'Removed from memory'], updateBrandKit: ['Updating brand kit', 'Updated brand kit'], addScene: ['Adding scene', 'Added scene'], addScenes: ['Adding scenes', 'Added scenes'], editScene: ['Updating scene', 'Updated scene'],
  inspectTimeline: ['Checking timeline', 'Checked timeline'], inspectClip: ['Checking clip', 'Checked clip'], inspectAssetAnalysis: ['Reading footage notes', 'Read footage notes'], analyzeMedia: ['Analyzing footage', 'Analyzed footage'], inspectVideo: ['Finding moments', 'Reviewed footage'], inspectFrames: ['Inspecting frames', 'Inspected frames'], inspectVideoFrames: ['Inspecting frames', 'Inspected frames'],
};
export { READ_ONLY_TOOLS };
/** These save outside the timeline (memory, brand kits); their own result is the confirmation. */
const SAVED_ELSEWHERE = new Set(['remember', 'forget', 'createBrandKit', 'updateBrandKit', 'saveBlueprint']);
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
    if(step.state==='error'&&!unresolved.has(id))continue;
    if (step.state === 'done' && READ_ONLY_TOOLS.has(step.name)) continue;
    const staged = (step.staged === true || step.output?.staged === true)&&!published(step.output);
    const savedEvidence = staged ? 'prepared' : SAVED_ELSEWHERE.has(step.name) || step.output?.saved === true || step.output?.unchanged === true || published(step.output) ? 'saved' : 'unconfirmed';
    const kind = step.name === 'markMusicBeats' ? `-${step.output?.kind ?? 'beats'}` : '';
    const key = step.state === 'error' ? `${step.name}-error-${id}` : `${step.name}${kind}-${step.state}-${savedEvidence}`;
    groups.set(key, [...groups.get(key) ?? [], { ...step, staged }]);
  }
  return [...groups].map(([key, group]) => {
    const step = group[0], name = TOOL_LABELS[step.name] ?? ['Working on your edit', 'Updated your edit'];
    if (step.state === 'error') return { key, title: 'Could not finish this step', detail: step.detail, state: step.state };
    if (step.state === 'running') return { key, title: name[0], state: step.state };
    const outputs = group.map(item => item.output ?? {});
    if (!step.staged && !SAVED_ELSEWHERE.has(step.name) && outputs.some(output => output.saved !== true && output.unchanged !== true&&!published(output))) return { key, title: 'Save not confirmed', detail: 'This step did not confirm a saved change.', state: 'error' };
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
    const draftFailed=receipt?(receipt.status==='failed'||receipt.status==='aborted')&&outputs.some(output=>output.revision===receipt.stagedRevision):evidence.draftFailed;
    if(step.staged&&draftFailed)return {key,title:`Not saved: ${title}`,detail:'The replacement edit was not saved.',state:'error',staged:true};
    if(step.staged&&(evidence.draftPending===false||receipt))return {key,title:'Save not confirmed',detail:'No saved confirmation is available for this edit.',state:'error'};
    const detail = [step.staged ? 'Awaiting save' : undefined, lowConfidence ? 'Beat detection has low confidence' : undefined].filter(Boolean).join(' · ') || undefined;
    return { key, title: step.staged && !unchanged ? `Prepared: ${title}` : title, detail, state: step.state, staged: step.staged };
  });
}
