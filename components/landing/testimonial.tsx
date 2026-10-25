import { LandingSection } from './ui';

export function LandingTestimonial() {
  return <LandingSection className="landing-testimonial" aria-label="Why Revline exists">
    <figure>
      <blockquote>“I built Revline because I was spending more time editing my videos than making them. Now I drop the footage in, say what I want, and just review the cut.”</blockquote>
      <figcaption><a href="https://x.com/zraonx" target="_blank" rel="noopener noreferrer"><img src="/landing/zraonx.webp" width={44} height={44} alt="" loading="lazy" /><span><strong>Zura</strong><span>@zraonx</span></span></a></figcaption>
    </figure>
  </LandingSection>;
}
