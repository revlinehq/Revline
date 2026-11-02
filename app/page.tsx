import { LandingNav } from '@/components/landing/nav';
import { LandingHero } from '@/components/landing/hero';
import { LandingFeatures } from '@/components/landing/features';
import { LandingMotionDesign } from '@/components/landing/motion-design';
import { LandingInspo } from '@/components/landing/inspo';
import { LandingClippers } from '@/components/landing/clippers';
import { LandingMcp } from '@/components/landing/mcp';
import { LandingPricing } from '@/components/landing/pricing';
import { LandingFaq } from '@/components/landing/faq';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingFooter } from '@/components/landing/footer';
import './landing.css';


export default function Home() {
  return <main className="landing">
    <LandingNav />
    <LandingHero />
    <LandingClippers />
    <LandingMotionDesign />
    <LandingFeatures />
    <LandingInspo />
    <LandingMcp />
    <LandingPricing />
    <LandingFaq />
    <LandingFinalCta />
    <LandingFooter />
  </main>;
}
