import { LandingSection } from './ui';

export function LandingTestimonial() {
  return <LandingSection className="landing-testimonial" aria-label="What creators say">
    <figure>
      <blockquote>“I used to lose every Sunday to editing our podcast. Now I type two sentences, grab a coffee, and review the cut. Revline gave me my weekends back.”</blockquote>
      <figcaption><a href="https://x.com/zraonx" target="_blank" rel="noopener noreferrer"><img src="/landing/zraonx.webp" width={44} height={44} alt="" loading="lazy" /><span><strong>Zura</strong><span>@zraonx</span></span></a></figcaption>
    </figure>
  </LandingSection>;
}
