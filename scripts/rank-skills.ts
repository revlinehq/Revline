/**
 * Ranks the editing agent's skills from most to least specific.
 * Usage: npm run skills:rank [-- --pages] [-- --worst 3]
 *
 * A rule is one sentence or bullet. It counts as concrete when it carries a number with a unit,
 * a Revline tool or code identifier, or an example (e.g., quoted text, bad→good, "for example").
 * Vague words are adjectives and hedges that give the agent nothing to check.
 */
import { editorSkills } from '../lib/ai/skills';

const args = process.argv.slice(2);
const withPages = args.includes('--pages');
const worstCount = Number(args[args.indexOf('--worst') + 1]) || 2;

const VAGUE = ['premium', 'elegant', 'polished', 'beautiful', 'stunning', 'modern', 'tasteful', 'appropriate', 'appropriately', 'natural', 'nice', 'great', 'good-looking', 'cinematic', 'professional', 'engaging', 'dynamic', 'seamless', 'seamlessly', 'balanced', 'compelling', 'sense of', 'feel', 'feels', 'vibe', 'as needed', 'when appropriate', 'if needed', 'where possible', 'carefully', 'properly', 'generally', 'usually', 'consider', 'try to', 'some', 'various', 'nicely', 'clean', 'crisp', 'punchy', 'intentional', 'thoughtful', 'refined', 'high-quality', 'quality', 'restrained'];
const NUMBER = /\d+(\.\d+)?\s*(px|s\b|ms|%|fps|x\b|×|frames?|°|pt|em|rem|seconds?|words?|lines?|chars?|characters?|db|hz|k\b)/i;
const BARE_NUMBER = /(^|[^a-z])\d+(\.\d+)?([^a-z]|$)/i;
const IDENTIFIER = /`[^`]+`|\b[a-z]+[A-Z][A-Za-z0-9]+\b|\b[a-z]+\.[a-z]+\(|\b(gsap|three|svg|css|ease|power\d|back\.out|expo)\b/;
const EXAMPLE = /e\.g\.|for example|for instance|such as|→|->|\bbad\b|\bgood\b|“[^”]{3,}”|"[^"]{3,}"/i;

type Unit = { name: string; body: string };
const units: Unit[] = editorSkills().flatMap(skill => withPages
  ? [{ name: skill.name, body: skill.body }, ...(skill.pages ?? []).map(page => ({ name: `${skill.name}/${page.name}`, body: page.body }))]
  : [{ name: skill.name, body: [skill.body, ...(skill.pages ?? []).map(page => page.body)].join('\n') }]);

function rules(body: string) {
  return body
    .split(/\n+/)
    .flatMap(line => line.replace(/^\s*([-*•]|\d+\.|#+)\s*/, '').split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map(rule => rule.trim())
    .filter(rule => rule.split(/\s+/).length >= 4 && !/^```/.test(rule));
}

function vagueHits(rule: string) {
  const lower = rule.toLowerCase();
  return VAGUE.filter(word => new RegExp(`(^|[^a-z-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z-]|$)`).test(lower));
}

function concreteness(rule: string) {
  return { number: NUMBER.test(rule) || BARE_NUMBER.test(rule), identifier: IDENTIFIER.test(rule), example: EXAMPLE.test(rule) };
}

const results = units.map(({ name, body }) => {
  const list = rules(body);
  const scored = list.map(rule => {
    const c = concreteness(rule);
    const vague = vagueHits(rule);
    const anchors = Number(c.number) + Number(c.identifier) + Number(c.example);
    return { rule, anchors, vague, concrete: anchors > 0 };
  });
  const total = scored.length || 1;
  const concretePct = scored.filter(s => s.concrete).length / total;
  const examplePct = scored.filter(s => concreteness(s.rule).example).length / total;
  const vagueWords = scored.flatMap(s => s.vague);
  const vaguePer10 = (vagueWords.length / total) * 10;
  const score = Math.round(Math.max(0, Math.min(100, concretePct * 70 + examplePct * 30 - vaguePer10 * 4)));
  const worst = scored
    .filter(s => !s.concrete || s.vague.length)
    .sort((a, b) => (a.anchors - b.anchors) || (b.vague.length - a.vague.length))
    .slice(0, worstCount);
  const counts = vagueWords.reduce<Record<string, number>>((acc, word) => ({ ...acc, [word]: (acc[word] ?? 0) + 1 }), {});
  const topVague = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word, n]) => `${word}×${n}`);
  return { name, score, rules: scored.length, concretePct, examplePct, topVague, worst };
}).sort((a, b) => b.score - a.score);

const pct = (n: number) => `${Math.round(n * 100)}%`;
console.log(`Skill specificity ranking (best → worst)${withPages ? ', per page' : ''}\n`);
results.forEach((r, i) => {
  const reasons = [
    `${pct(r.concretePct)} of ${r.rules} rules carry a number, tool or example`,
    `${pct(r.examplePct)} give an example`,
    r.topVague.length ? `vague words: ${r.topVague.join(', ')}` : 'no vague words',
  ];
  console.log(`${String(i + 1).padStart(2)}. ${r.name.padEnd(32)} ${String(r.score).padStart(3)}/100  ${reasons.join('; ')}`);
  for (const w of r.worst) console.log(`      ✗ "${w.rule.length > 140 ? `${w.rule.slice(0, 137)}…` : w.rule}"${w.vague.length ? ` [${w.vague.join(', ')}]` : ' [no number, tool or example]'}`);
});
