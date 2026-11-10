import { LandingShot } from './ui';

const blocks = [
  {
    id: 'campaigns', label: 'Campaigns', title: 'Know what a clip pays before you make it.',
    text: 'Every campaign shows its rate per 1K views on each platform and how much budget is left.',
    shot: 'campaign-detail', alt: 'A campaign page in Revline showing the rate per 1K views for each platform, the minimum and maximum payout, and the budget left.',
  },
  {
    id: 'editor', label: 'Editor', title: 'Subtitles, layout and a hook, without opening a timeline.',
    text: 'Turn subtitles on, pick a layout and type a hook. The timeline is there when you want it.',
    shot: 'editor-workspace', alt: 'The Revline editor with the Effects tab open: a subtitles switch, a layout choice and a hook field beside a vertical clip.',
  },
  {
    id: 'posting', label: 'Posting and stats', title: 'Post to all your accounts and see what each clip earned.',
    text: 'Choose the accounts, post now or schedule, then follow views for each campaign.',
    note: 'Earnings shown are estimates.',
    shot: 'stats', alt: 'The Stats page in Revline: estimated earnings, views, posts and accounts, with a row for each campaign.',
  },
];

/** Three product blocks, screenshot and copy side by side, alternating sides. */
export function LandingProduct() {
  return <div className="landing-section landing-product">{blocks.map(block => <section key={block.id} id={block.id} className="landing-product-block" aria-labelledby={`landing-${block.id}-heading`}>
    <div className="landing-product-copy">
      <span className="landing-product-label">{block.label}</span>
      <h2 id={`landing-${block.id}-heading`}>{block.title}</h2>
      <p>{block.text}</p>
      {block.note && <small>{block.note}</small>}
    </div>
    <LandingShot name={block.shot} alt={block.alt} />
  </section>)}</div>;
}
