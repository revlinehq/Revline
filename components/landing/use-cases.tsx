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
    <span>{label}</span>
  </li>)}</ul>;
}

export function LandingUseCases() {
  return <section id="use-cases" className="landing-use-cases landing-section" aria-labelledby="landing-use-cases-heading">
    <header className="landing-section-header">
      <h2 id="landing-use-cases-heading">Edit any kind of<br />video with Revline</h2>
      <p>Podcasts, vlogs, product demos, tutorials, ads and more. No editing experience required.</p>
    </header>
    <div className="landing-carousel">{rows.map((tiles, index) => <div key={index} className="landing-marquee" data-direction={index ? 'right' : 'left'}>
      <div className="landing-marquee-track"><TileSet tiles={tiles} /><TileSet tiles={tiles} hidden /></div>
    </div>)}</div>
  </section>;
}
