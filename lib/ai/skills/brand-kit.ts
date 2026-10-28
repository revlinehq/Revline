import type { EditorSkill } from './index';

export const brandKit: EditorSkill = {
  name: 'brand-kit',
  description: 'Find, create, confirm and use a saved brand kit (fonts, colors, logo, brand context) for branded scenes and launch films. Read before listBrandKits, createBrandKit, updateBrandKit, or any scene that should look like a real brand.',
  body: `# Brand kits

A brand kit is a named, saved brand for this user: colors, font files, a logo, the landing-page copy, and a brand context (what the product is, the problem it solves, who it is for, key features, call to action, tone). Scenes attach a kit with \`brandKitId\` and receive it as \`brand\`.

## Workflow

1. **Check first.** Call listBrandKits before any branded scene or launch film.
   - One kit clearly fits: ask "Use the <name> brand kit for this video?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL, or for a theme (colors, Google Fonts names, logo SVG) if there is no site.
2. **Create.** createBrandKit with the URL (and any theme values the user gave; those win). Name it after the brand, e.g. "Revline".
3. **Show what was found.** Report fonts by role, the main colors, whether a logo was found, and every note (missing fonts, no logo). Ask the user to correct anything wrong; fix it with updateBrandKit. Never pretend a missing piece was found.
4. **Confirm the brand context.** Draft it from the scraped copy (title, description, headings), then ask the user to confirm or correct, in one short message:
   - What the product is, in one sentence.
   - The problem it solves.
   - Who it is for.
   - The 3 to 5 features worth showing.
   - The call to action (and URL).
   - The tone (e.g. calm and precise, playful, bold).
   Ask only about what the copy does not answer. Save the confirmed version with updateBrandKit context. Do not build scenes on an unconfirmed context.
5. **Use.** Pass \`brandKitId\` to addScene (or editScene to attach or refresh). A scene keeps the kit as it was when saved.

## In scene code

\`brand\` is null when no kit is attached. With a kit:

- \`brand.fonts.heading\`, \`brand.fonts.body\`: family names, already loaded. Use them in CSS: \`font-family:'\${brand.fonts.heading}'\`. Weights saved in the kit are the ones that exist; use those.
- \`brand.colors\`: named colors from the site (e.g. \`brand.colors.primary\`, \`brand.colors.background\`, or \`color-1\`, \`color-2\` by frequency). \`brand.palette\` lists them in order. Read the names with getBrandKit before relying on one; fall back if a name is missing.
- \`brand.logo\`: a data URL for \`<img src>\`. \`brand.logoSvg\`: the SVG markup when the logo is vector (null otherwise). Insert it to animate its paths (DrawSVG, stagger the paths, morph).

\`\`\`ts
export default function scene({ root, tl, brand, height }) {
  const font = brand ? \`'\${brand.fonts.heading}'\` : 'Inter';
  const ink = brand?.colors.foreground ?? '#f2f2f4';
  root.innerHTML = \`<div class="lockup" style="position:absolute;inset:0;display:grid;place-items:center;gap:24px;color:\${ink};font-family:\${font}">
    <div class="mark" style="width:\${height * 0.14}px">\${brand?.logoSvg ?? ''}</div></div>\`;
  tl.from(root.querySelectorAll('.mark path'), { opacity: 0, y: 20, duration: 0.6, ease: 'expo.out', stagger: 0.06 }, 0.2);
}
\`\`\`

Colors from a scrape are candidates, not a design system: pick a background, one text color and one accent from them, and keep to those.`,
};
