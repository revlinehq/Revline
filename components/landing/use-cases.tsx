import { LandingChip, LandingHeading, LandingSection } from './ui';

type Tile = { label: string; image: string; wide?: boolean };

const rows: Tile[][] = [
  [
    { label: 'Podcast clip', image: 'podcast' },
    { label: 'Product demo', image: 'code-screen', wide: true },
    { label: 'Vlog', image: 'vlog', wide: true },
    { label: 'Social video', image: 'talking-head' },
    { label: 'Tutorial', image: 'classroom', wide: true },
    { label: 'Ad', image: 'beauty' },
  ],
  [
    { label: 'Talking head', image: 'talking-head' },
    { label: 'Walkthrough', image: 'podcast' },
    { label: 'UGC ad', image: 'classroom', wide: true },
    { label: 'Highlight reel', image: 'code-screen', wide: true },
    { label: 'Course lesson', image: 'beauty' },
    { label: 'Short', image: 'vlog', wide: true },
  ],
];

function TileSet({ tiles, hidden = false }: { tiles: Tile[]; hidden?: boolean }) {
  return <ul className="landing-marquee-set" aria-hidden={hidden || undefined}>{tiles.map(({ label, image, wide }) => <li key={label} className={wide ? 'landing-tile landing-tile-wide' : 'landing-tile'}>
    <img src={`/landing/${image}.webp`} alt="" loading="lazy" decoding="async" />
    <LandingChip>{label}</LandingChip>
  </li>)}</ul>;
}

export function LandingUseCases() {
  return <LandingSection id="use-cases" className="landing-use-cases" headingId="landing-use-cases-heading">
    <LandingHeading id="landing-use-cases-heading" title="Edited with AI in Revline" description="Real creator videos, cut from raw footage by one prompt." />
    <div className="landing-carousel">{rows.map((tiles, index) => <div key={index} className="landing-marquee" data-direction={index ? 'right' : 'left'}>
      <div className="landing-marquee-track"><TileSet tiles={tiles} /><TileSet tiles={tiles} hidden /></div>
    </div>)}</div>
  </LandingSection>;
}
