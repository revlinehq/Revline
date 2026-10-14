export type TimelinePublicationReceipt={
  version:1;
  kind:'timeline-publication';
  runId:string;
  threadId:string;
  promptMessageId:string;
  stagedRevision:number;
}&({status:'saved';revision:number}|{status:'failed'|'aborted'});
