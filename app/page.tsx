import Link from 'next/link';
import { Brand } from '@/components/workspace/brand';
import { LandingHero } from '@/components/landing/hero';
import { LandingShowcase } from '@/components/landing/showcase';
import { Workflow } from '@/components/landing/workflow';
import { LandingFeatures } from '@/components/landing/features';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq, LandingFooter } from '@/components/landing/footer';
import { LandingStartButton } from '@/components/landing/start-button';
import '@/components/workspace/shared.css';
import './landing.css';

export default function Home() {
  return <main className="landing">
    <nav className="landing-nav landing-container" aria-label="Main navigation">
      <Link className="landing-brand" href="/" aria-label="Revline home"><Brand /></Link>
      <LandingStartButton compact play={false} className="landing-nav-start" />
    </nav>
    <LandingHero />
    <LandingShowcase />
    <Workflow heading="The simplest way to edit." />
    <LandingFeatures />
    <LandingPricing />
    <LandingFaq />
    <section className="landing-final-cta landing-section" aria-labelledby="landing-closing-heading">
      <div className="landing-final-copy"><h2 id="landing-closing-heading">Your next edit starts here.</h2><p>Turn the footage you have into the video you had in mind.</p></div>
      <div className="landing-final-action"><LandingStartButton /></div>
    </section>
    <LandingFooter />
  </main>;
}
