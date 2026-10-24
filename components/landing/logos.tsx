const logos = [
  { name: 'Northwind', font: 'head', weight: 600 },
  { name: 'lumen.fm', font: 'mono', weight: 500 },
  { name: 'Parallax', font: 'head', weight: 400 },
  { name: 'HALCYON', font: 'body', weight: 700 },
  { name: 'Orbitly', font: 'head', weight: 500 },
  { name: 'fieldwork', font: 'body', weight: 500 },
] as const;

export function LandingLogos() {
  return <section className="landing-logos landing-section" aria-label="Teams using Revline">
    <p>Editing faster with Revline at</p>
    <ul>{logos.map(({ name, font, weight }) => <li key={name} style={{ fontFamily: `var(--landing-font-${font})`, fontWeight: weight }}>{name}</li>)}</ul>
  </section>;
}
