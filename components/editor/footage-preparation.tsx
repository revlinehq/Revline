import { Film } from 'lucide-react';
import { ProcessingStatus } from './processing-status';
import './footage-preparation.css';

export function FootagePreparation({thumbnail,error,onRetry}:{thumbnail?:string|null;error?:string|null;onRetry?:()=>void}) {
  return <section className="footage-preparation" aria-label="Preparing footage">
    <div className="footage-preparation-content">
      <div className="footage-preparation-thumbnail">{thumbnail?<img src={thumbnail} alt=""/>:<Film size={30} strokeWidth={1}/>}</div>
      <ProcessingStatus label={error?'Footage couldn’t load':'Preparing footage…'} detail={error||'Your editor opens when playback is ready.'} state={error?'error':'working'}/>
      {error&&onRetry?<button type="button" onClick={onRetry}>Try again</button>:<small>Getting video and audio ready</small>}
    </div>
  </section>;
}
