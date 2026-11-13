import type { RunFailureCode } from '@/lib/ai/run-failure';
import type { TimelinePublicationReceipt } from '@/lib/ai/publication-receipt';

export type ChatTool = { id?: string; name: string; state: 'running' | 'done' | 'error' | 'stopped'; detail?: string; /** What kind of failure an error step met (lib/ai/run-failure). */ failureCode?: RunFailureCode; staged?: boolean; input?: Record<string, unknown>; output?: Record<string, unknown> };
export type ChatBlock = { type:'text'; text:string } | { type:'tools'; steps:ChatTool[] } | { type:'thinking'; text:string };
export type ChatMessage = { /** The API model id and effort this turn's run recorded. */ turnModel?:string;turnEffort?:string;turnError?:string;/** What kind of failure turnError is; absent on turns stored before codes. */turnErrorCode?:RunFailureCode;turnResuming?:boolean;turnState?:'running'|'completed'|'failed'|'stopped';id:string;sourceId?:string;threadId?:string;role:string;text:string;status?:string;tools?:string[];steps?:ChatTool[];blocks?:ChatBlock[];publicationReceipt?:TimelinePublicationReceipt };
export type ResultCard = { key: string; title: string; detail?: string; failureCode?: RunFailureCode; state: ChatTool['state']; staged?: boolean; saveFailed?: boolean };
