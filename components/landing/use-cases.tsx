import type { CSSProperties } from 'react';
import { LandingTileVideo } from './tile-video';
import { LandingChip, LandingHeading, LandingSection } from './ui';

// A tile shows a still, or a real film made in Revline (`video`, served from public/landing with its poster).
// A video's `ratio` is its real frame (width / height); its tile is that shape at the row's height, so no film is cropped.
// `credit` adds a small attribution line on the tile.
type Tile = { label: string; image?: string; video?: { src: string; poster: string; ratio: number }; wide?: boolean; credit?: string };

const rows: Tile[][] = [
  [
    { label: 'Launch film', video: { src: '/landing/kinetic-launch.mp4', poster: '/landing/kinetic-launch-poster.webp', ratio: 16 / 9 } },
    { label: 'Motion', video: { src: '/landing/jensen-motion-vertical.mp4', poster: '/landing/jensen-motion-vertical-poster.webp', ratio: 608 / 1080 } },
    { label: 'Voice typing', video: { src: '/landing/voice-typing.mp4', poster: '/landing/voice-typing-poster.webp', ratio: 16 / 9 } },
    { label: 'Podcast clip', image: 'podcast' },
    { label: 'Product demo', image: 'code-screen', wide: true },
    { label: 'Vlog', image: 'vlog', wide: true },
    { label: 'Social video', image: 'talking-head' },
    { label: 'Tutorial', image: 'classroom', wide: true },
    { label: 'Ad', image: 'beauty' },
  ],
  [
    { label: 'Save Reminders', video: { src: '/landing/save-reminders.mp4', poster: '/landing/save-reminders-poster.webp', ratio: 16 / 9 }, credit: 'Concept inspired by @mosycreate' },
    { label: 'Explainer', video: { src: '/landing/how-servers-work-tile.mp4', poster: '/landing/how-servers-work-poster.webp', ratio: 16 / 9 } },
    { label: 'Talking head', image: 'talking-head' },
    { label: 'Walkthrough', image: 'podcast' },
    { label: 'UGC ad', image: 'classroom', wide: true },
    { label: 'Highlight reel', image: 'code-screen', wide: true },
    { label: 'Course lesson', image: 'beauty' },
    { label: 'Short', image: 'vlog', wide: true },
  ],
];

function TileSet({ tiles, hidden = false }: { tiles: Tile[]; hidden?: boolean }) {
  return <ul className="landing-marquee-set" aria-hidden={hidden || undefined}>{tiles.map(({ label, image, video, wide, credit }) => <li key={label} className={wide ? 'landing-tile landing-tile-wide' : 'landing-tile'} style={video ? { '--tile-ratio': video.ratio } as CSSProperties : undefined} data-video={video ? '' : undefined}>
    {video ? <LandingTileVideo src={video.src} poster={video.poster} label={label} ratio={video.ratio} hidden={hidden} /> : <img src={`/landing/${image}.webp`} alt="" loading="lazy" decoding="async" />}
    {credit && <small className="landing-tile-credit">{credit}</small>}
    <LandingChip>{label}</LandingChip>
  </li>)}</ul>;
}

export function LandingUseCases() {
  return <LandingSection id="use-cases" className="landing-use-cases" headingId="landing-use-cases-heading">
    <LandingHeading id="landing-use-cases-heading" title="Edited with Revline" description="Real creator videos, cut from raw footage by one prompt." />
    <div className="landing-carousel">{rows.map((tiles, index) => <div key={index} className="landing-marquee" data-direction={index ? 'right' : 'left'}>
      <div className="landing-marquee-track"><TileSet tiles={tiles} /><TileSet tiles={tiles} hidden /></div>
    </div>)}</div>
  </LandingSection>;
}
