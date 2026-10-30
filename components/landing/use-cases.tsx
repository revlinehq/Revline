import { LandingTileVideo } from './tile-video';
import { LandingChip, LandingHeading, LandingSection } from './ui';

// A tile shows a still, or a real film made in Revline (`video`, served from public/landing with its poster).
// `classic` tiles are 4:3; `credit` adds a small attribution line on the tile.
type Tile = { label: string; image?: string; video?: { src: string; poster: string }; wide?: boolean; classic?: boolean; credit?: string };

const rows: Tile[][] = [
  [
    { label: 'Launch film', video: { src: '/landing/kinetic-launch.mp4', poster: '/landing/kinetic-launch-poster.webp' }, wide: true },
    { label: 'Voice typing', video: { src: '/landing/voice-typing.mp4', poster: '/landing/voice-typing-poster.webp' }, wide: true },
    { label: 'Podcast clip', image: 'podcast' },
    { label: 'Product demo', image: 'code-screen', wide: true },
    { label: 'Vlog', image: 'vlog', wide: true },
    { label: 'Social video', image: 'talking-head' },
    { label: 'Tutorial', image: 'classroom', wide: true },
    { label: 'Ad', image: 'beauty' },
  ],
  [
    { label: 'Save Reminders', video: { src: '/landing/save-reminders.mp4', poster: '/landing/save-reminders-poster.webp' }, classic: true, credit: 'Concept inspired by @mosycreate' },
    { label: 'Talking head', image: 'talking-head' },
    { label: 'Walkthrough', image: 'podcast' },
    { label: 'UGC ad', image: 'classroom', wide: true },
    { label: 'Highlight reel', image: 'code-screen', wide: true },
    { label: 'Course lesson', image: 'beauty' },
    { label: 'Short', image: 'vlog', wide: true },
  ],
];

function TileSet({ tiles, hidden = false }: { tiles: Tile[]; hidden?: boolean }) {
  return <ul className="landing-marquee-set" aria-hidden={hidden || undefined}>{tiles.map(({ label, image, video, wide, classic, credit }) => <li key={label} className={wide ? 'landing-tile landing-tile-wide' : classic ? 'landing-tile landing-tile-classic' : 'landing-tile'}>
    {video ? <LandingTileVideo src={video.src} poster={video.poster} label={label} ratio={classic ? 4 / 3 : 16 / 9} hidden={hidden} /> : <img src={`/landing/${image}.webp`} alt="" loading="lazy" decoding="async" />}
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
