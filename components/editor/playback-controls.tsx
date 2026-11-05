'use client';

import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { IconButton } from './primitives';
import { PlaybackTime } from './playback-time';

export function PlaybackControls({ playing, time, duration, fps, readTime, onTogglePlay, onPrevious, onNext }: { playing: boolean; time: number; duration: number; fps: number; readTime?: () => number; onTogglePlay: () => void; onPrevious: () => void; onNext: () => void }) {
  return <div className="preview-playback" aria-label="Preview playback"><IconButton label="Previous cut" onClick={onPrevious} disabled={!duration}><SkipBack size={16} strokeWidth={1.5}/></IconButton><IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onTogglePlay} disabled={!duration}>{playing ? <Pause size={17} strokeWidth={1.5}/> : <Play size={17} strokeWidth={1.5}/>}</IconButton><IconButton label="Next cut" onClick={onNext} disabled={!duration}><SkipForward size={16} strokeWidth={1.5}/></IconButton><PlaybackTime className="preview-time" time={time} duration={duration} fps={fps} playing={playing} readTime={readTime}/></div>;
}
