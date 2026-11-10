import Link from 'next/link';

// Campaigns and AI Editor are sections of the landing page; the rest are their own routes.
const columns = [
  { title: 'Product', links: [{ label: 'Campaigns', href: '/#campaigns' }, { label: 'AI Editor', href: '/#editor' }, { label: 'Pricing', href: '/pricing' }] },
  { title: 'Company', links: [{ label: 'Blog', href: '/blog' }] },
  { title: 'Legal', links: [{ label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }] },
];

export function LandingFooter() {
  return <footer className="landing-footer landing-section">
    <div className="landing-footer-top">
      <div className="landing-footer-brand"><strong>Revline</strong><p>The AI editor for clippers.</p></div>
      <nav className="landing-footer-columns" aria-label="Footer navigation">{columns.map(column => <div key={column.title}>
        <h2>{column.title}</h2>
        <ul>{column.links.map(link => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul>
      </div>)}</nav>
    </div>
    <div className="landing-footer-bottom">
      <small>© 2026 Revline</small>
      <small>Campaign data from Content Rewards. Revline is not affiliated with Content Rewards.</small>
    </div>
  </footer>;
}
