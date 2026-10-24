import { notFound } from 'next/navigation';
import { BrandLoader } from '@/components/workspace/brand';
import './loaders.css';

const PLACES = [
  { label: 'Signing you in…', where: 'SSO callback' },
  { label: 'Loading your chats…', where: 'Chat history' },
  { label: 'Loading your account…', where: 'Profile' },
  { label: 'Checking your plan…', where: 'Editor access gate' },
  { label: 'Loading timeline…', where: 'Shared timeline' },
  { label: 'Updating your edit…', where: 'Editor stage' },
];

/** Development-only gallery of every Revline loading state. */
export default function LoadersFixturePage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <main className="dev-loaders">
    <header><h1>Revline loaders</h1><p>Development only. Each fold traces its outline, fills, then loops.</p></header>
    <section><h2>Where they appear</h2><div className="dev-loaders-grid">
      {PLACES.map(place => <figure key={place.where}><div className="dev-loaders-stage"><BrandLoader label={place.label} announce={false}/></div><figcaption>{place.where}</figcaption></figure>)}
    </div></section>
    <section><h2>Sizes</h2><div className="dev-loaders-row">
      {[24, 34, 44, 64, 96].map(size => <figure key={size}><div className="dev-loaders-stage"><BrandLoader size={size} announce={false}/></div><figcaption>{size}px{size === 34 ? ' · preview' : size === 44 ? ' · page load' : size === 40 ? ' · default' : ''}</figcaption></figure>)}
    </div></section>
    <section><h2>Themes</h2><div className="dev-loaders-row">
      <figure><div className="dev-loaders-stage"><BrandLoader label="Light" announce={false}/></div><figcaption>Light workspace</figcaption></figure>
      <figure><div className="dev-loaders-stage dev-loaders-dark"><BrandLoader label="Dark" announce={false}/></div><figcaption>Dark workspace</figcaption></figure>
      <figure><div className="dev-loaders-stage dev-loaders-preview"><BrandLoader size={34} announce={false}/></div><figcaption>Editor preview, first load</figcaption></figure>
      <figure><div className="dev-loaders-stage dev-loaders-reduced"><BrandLoader label="Reduced motion" announce={false}/></div><figcaption>prefers-reduced-motion</figcaption></figure>
    </div></section>
    <section><h2>Page load</h2><div className="dev-loaders-route"><BrandLoader size={44} announce={false}/></div></section>
  </main>;
}
