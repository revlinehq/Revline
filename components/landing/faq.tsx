import { Minus, Plus } from 'lucide-react';

const questions = [
  ['What is Revline, and who is it for?', 'Revline is an AI video editor you talk to. Upload raw footage, describe what you want, and the agent cuts, captions and formats it for you. It’s built for creators, podcasters, marketers and teams who publish video but don’t want to live in a timeline.'],
  ['What kinds of videos can I make?', 'Podcast clips, vlogs, product demos, tutorials, ads, talking-head videos and social shorts. If you filmed it, Revline can help you edit it.'],
  ['How is Revline different from a regular video editor?', 'You describe the edit instead of building it by hand. Revline makes the cuts, captions and framing for you, then you review the result and refine it in conversation.'],
  ['Can I still edit the timeline myself?', 'Yes. Every change the agent makes lands on a real timeline. Trim, move, duplicate or delete clips yourself, and undo anything.'],
  ['What file formats and lengths are supported?', 'Upload common video, audio and image files, or import a YouTube link. Long recordings are fine.'],
  ['Will my videos use my brand fonts and colors?', 'Ask for them in the conversation. Revline can style captions and titles with its built-in fonts and the colors you choose.'],
  ['Is my footage private?', 'Your projects belong to your account and require sign-in. Your footage is used to prepare your edits and exports.'],
  ['How much does Revline cost? Is there a free plan?', 'Revline is one plan at $39 USD per month, after a 3-day free trial. Cancel before the trial ends if you don’t want to continue.'],
];

export function LandingFaq() {
  return <section id="faq" className="landing-faq landing-section" aria-labelledby="landing-faq-heading">
    <h2 id="landing-faq-heading">Frequently asked questions</h2>
    <div className="landing-faq-list">{questions.map(([question, answer], index) => <details name="landing-faq" key={question} open={index === 0}>
      <summary>{question}<Plus className="landing-faq-plus" size={18} aria-hidden="true" /><Minus className="landing-faq-minus" size={18} aria-hidden="true" /></summary>
      <p>{answer}</p>
    </details>)}</div>
  </section>;
}
