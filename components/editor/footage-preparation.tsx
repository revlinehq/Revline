import { Film } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProcessingStatus } from './processing-status';
import './footage-preparation.css';

export function FootagePreparation({thumbnail,fileName,activity,label='Processing footage…',detail='Your editor opens when playback, audio and thumbnails are ready.',error,onRetry,children}:{thumbnail?:string|null;fileName?:string;activity?:string;label?:string;detail?:string;error?:string|null;onRetry?:()=>void;children?:ReactNode}) {
  return <section className="footage-preparation" aria-label="Preparing footage">
    <div className="footage-preparation-content">
      {fileName && <span className="footage-preparation-filename" title={fileName}>{fileName}</span>}
      <div className="footage-preparation-thumbnail">{thumbnail?<img src={thumbnail} alt=""/>:<Film size={30} strokeWidth={1}/>}</div>
      <ProcessingStatus label={error?'Footage couldn’t load':label} detail={error||detail} state={error?'error':'working'}/>
      {error&&onRetry?<button type="button" onClick={onRetry}>Try again</button>:activity?<small className="footage-preparation-activity">{activity}</small>:null}
      {children}
    </div>
  </section>;
}
