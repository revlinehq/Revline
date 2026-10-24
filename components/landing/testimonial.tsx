import { LandingSection } from './ui';

export function LandingTestimonial() {
  return <LandingSection className="landing-testimonial" aria-label="What creators say">
    <figure>
      <blockquote>“I used to lose every Sunday to editing our podcast. Now I type two sentences, grab a coffee, and review the cut. Revline gave me my weekends back.”</blockquote>
      <figcaption><img src="/landing/maya-okafor.webp" width={44} height={44} alt="" loading="lazy" /><span><strong>Maya Okafor</strong><span>Host, The Long Take podcast</span></span></figcaption>
    </figure>
  </LandingSection>;
}
