import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { EDITOR_PLAN } from '@/lib/billing/plan';
import { LandingHeading, LandingSection } from './ui';

const questions = [
  ['Where do the campaigns come from?', 'They are public campaigns listed on Content Rewards. Revline shows the rate and the budget left so you can pick quickly.'],
  ['Does Revline pay me?', 'No. You join the campaign, submit your posts and get paid on Content Rewards. Revline makes the clips and posts them.'],
  ['How much can I earn?', 'It depends on the campaign\'s rate and how many views your clips get. Earnings shown in Revline are estimates.'],
  ['Which platforms can I post to?', 'TikTok, Instagram and YouTube. You connect your accounts once.'],
  ['Do I need to know how to edit?', 'No. Drop the footage and Revline cuts the clips. You can change subtitles, layout and the hook with one click.'],
  ['Can I cancel?', `Yes, anytime. The first ${EDITOR_PLAN.trialDays} days are free.`],
];

/** Every answer starts open, so the server-rendered page reads in full before any script runs. */
export function LandingFaq() {
  return <LandingSection id="faq" className="landing-faq" headingId="landing-faq-heading">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: questions.map(([name, text]) => ({
        '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text },
      })),
    }).replace(/</g, '\\u003c') }} />
    <LandingHeading id="landing-faq-heading" title="Questions" />
    <Accordion type="multiple" defaultValue={questions.map(([question]) => question)} className="landing-faq-list">
      {questions.map(([question, answer]) => <AccordionItem key={question} value={question}>
        <AccordionTrigger>{question}</AccordionTrigger>
        <AccordionContent><p>{answer}</p></AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </LandingSection>;
}
