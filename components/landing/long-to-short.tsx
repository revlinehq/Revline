'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LandingHeading, LandingSection } from './ui';

// Source ranges from project j97606nxmxjxpzb0x26fqys0xd8hbdg5, main timeline, revision 216.
// [start, duration] in playback order; the closing line moves to the end.
const RAW_SECONDS = 187.472222;
const cuts: [number, number][] = [
  [2.48, 2.55], [10.56, 4.61], [38.63, 4.68], [55.775, 1.935], [70.14, 1.62], [96.99, 1.36], [102.715, 2.975], [117.76, 1.59], [119.68, 1.75],
  [126.35, 2.4], [134.88, .69], [141.62, .97], [148.08, 1.46], [149.69, .85], [158.045, 1.975], [165.34, 2.5], [169.26, 1.74], [183.645, 2.675], [7.92, 1.81],
];
const pct = (seconds: number) => `${(seconds / RAW_SECONDS) * 100}%`;
// The stretches Revline cut, dimmed on the strip: everything between the kept ranges in source order.
const dropped = [...cuts].sort((a, b) => a[0] - b[0]).reduce<{ gaps: [number, number][]; end: number }>(({ gaps, end }, [start, length]) =>
  ({ gaps: start > end ? [...gaps, [end, start - end]] : gaps, end: Math.max(end, start + length) }), { gaps: [], end: 0 });
const gaps: [number, number][] = [...dropped.gaps, [dropped.end, RAW_SECONDS - dropped.end]];

/** Where in the raw recording the short is at `time`: the cut playing and the source second it shows. */
function sourceAt(time: number) {
  let elapsed = 0;
  for (let index = 0; index < cuts.length; index++) {
    const [start, length] = cuts[index];
    if (time < elapsed + length) return { index, source: start + time - elapsed };
    elapsed += length;
  }
  return { index: cuts.length - 1, source: cuts[cuts.length - 1][0] + cuts[cuts.length - 1][1] };
}

/** One wide card: the raw take as a filmstrip with the kept moments lit, beside the finished short.
 *  A playhead on the strip follows the short as it plays, so you can see which moment each cut came from. */
export function LandingLongToShort() {
  const video = useRef<HTMLVideoElement>(null);
  const manuallyPaused = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState({ index: 0, source: cuts[0][0] });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = true;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !motion.matches && !manuallyPaused.current) {
        void element.play().catch(() => {});
      } else element.pause();
    }, { threshold: .25 });
    const respectMotion = () => { if (motion.matches) element.pause(); };
    observer.observe(element);
    motion.addEventListener('change', respectMotion);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', respectMotion);
    };
  }, []);

  function togglePlayback() {
    const element = video.current;
    if (!element) return;
    manuallyPaused.current = !element.paused;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }

  return <LandingSection id="long-to-short" className="landing-long-to-short" headingId="landing-long-to-short-heading">
    <LandingHeading id="landing-long-to-short-heading" title="One long take in. A clean short out." description="Revline watched a 3 minute recording, kept the best 40 seconds, and cut every retake and pause." />
    <Card className="landing-lts-card ring-0">
      <div className="landing-lts-raw">
        <div className="landing-lts-label"><span>Raw recording</span><span>3:07</span></div>
        <div className="landing-lts-strip" role="img" aria-label="The full recording, with 19 kept moments highlighted and retakes dimmed" style={{ backgroundImage: 'url(/landing/long-to-short-strip.webp)' }}>
          {gaps.map(([start, length]) => <span key={start} className="landing-lts-cut" style={{ left: pct(start), width: pct(length) }} />)}
          {cuts.map(([start, length], index) => <span key={index} className="landing-lts-keep" data-on={index === now.index || undefined} style={{ left: pct(start), width: pct(length) }} />)}
          <span className="landing-lts-head" style={{ left: pct(now.source) }} aria-hidden="true" />
        </div>
        <div className="landing-lts-ticks" aria-hidden="true"><span>0:00</span><span>1:00</span><span>2:00</span><span>3:07</span></div>
        <div className="landing-lts-legend"><span><i />{cuts.length} moments kept</span><span>Retakes and pauses cut</span></div>
      </div>
      <div className="landing-lts-short">
        <div className="landing-lts-player">
          <video id="landing-lts-video" ref={video} src="/landing/long-to-short.mp4" poster="/landing/long-to-short-poster.webp" width={540} height={960} muted loop playsInline preload="none" onTimeUpdate={event => setNow(sourceAt(event.currentTarget.currentTime))} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-label="A muted preview of the 40 second cut" />
          <Button variant="ghost" size="icon" className="landing-lts-play" onClick={togglePlayback} aria-label={playing ? 'Pause short preview' : 'Play short preview'} aria-controls="landing-lts-video">
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
        </div>
        <div className="landing-lts-label"><span>Short</span><span>0:40</span></div>
      </div>
    </Card>
  </LandingSection>;
}
