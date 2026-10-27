import { Geist, Geist_Mono, Outfit } from 'next/font/google';
import { LandingStartButton } from '@/components/landing/start-button';
import { HeroDemo } from '@/components/landing/hero-demo';
import '../landing.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--landing-font-head' });
const geist = Geist({ subsets: ['latin'], variable: '--landing-font-body' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--landing-font-mono' });

export const metadata = { title: 'Hero demo prototype · Revline', robots: { index: false, follow: false } };

/** Local preview of the live hero demo, in the hero's own layout, before it replaces the screenshot. */
export default function DemoHeroPage() {
  return <main className={`landing ${outfit.variable} ${geist.variable} ${geistMono.variable}`}>
    <section className="landing-section landing-hero">
      <div className="landing-hero-copy">
        <h1>The AI video editor that<br />actually does the editing</h1>
        <p>From podcasts and YouTube videos to product demos, ads, and social clips.<br />Revline cuts, captions, reframes, and polishes every video for you.</p>
        <div className="landing-hero-actions"><LandingStartButton /></div>
      </div>
      <div className="landing-product-frame"><HeroDemo /></div>
    </section>
  </main>;
}
