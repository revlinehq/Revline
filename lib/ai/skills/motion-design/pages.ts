import type { EditorSkillPage } from '../index';

/** A new film for the user's own brand starts here: nothing is designed before the brand is known. */
export const brandPage: EditorSkillPage = {
  name: 'brand-kit',
  description: 'First for a new film for the user\'s own brand: find, create and confirm the brand kit (fonts, colors, logo, screens, product text), and how scenes use it. Not used when recreating a given video.',
  body: `# Brand kit

A brand kit is a named, saved brand for this user: colors, font files, a logo, the landing-page copy, the product text (what it is, the problem it solves, the features worth showing), and saved product screens. Scenes attach it with \`brandKitId\` and receive it as \`brand\`.

Not for recreating a video the user gave: a clone takes its brand from the video's own frames, with no kit and no questions (motion-design, "Recreating a video").

## Workflow
1. **Check first.** listBrandKits.
   - One kit clearly fits: ask "Use the <name> brand kit for this video?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL, or for a theme (colors, Google Fonts names, logo SVG) if there is no site.
2. **Create.** createBrandKit with the URL (and any theme values the user gave; those win). Name it after the brand.
3. **Show what was found.** Fonts by role, the main colors, whether a logo was found, and every note. Ask the user to correct anything wrong; fix it with updateBrandKit. Never pretend a missing piece was found.
4. **Confirm the product.** Draft one product text from the scraped copy: what it is, the problem it solves and the 3 to 5 features worth showing (features as short lines). Show it and ask the user to correct it, asking only about what the copy does not answer. Save the confirmed text with updateBrandKit context.product. Never build on an unconfirmed product text.
5. **Screens.** Product screenshots belong to the brand, not one project. Check the kit's screens (getBrandKit). When the user gives screenshots, offer to save them to the kit (updateBrandKit addScreens, named like editor, dashboard, settings, with a short note) so every later video reuses them without re-uploading.
6. **Use.** Pass \`brandKitId\` to addFilm or addScene (or editScene to attach or refresh). A scene keeps the kit as it was when saved.

## In scene code
\`brand\` is null without a kit. With one:
- \`brand.fonts.heading\`, \`brand.fonts.body\`: loaded family names. \`font-family:'\${brand.fonts.heading}'\`.
- \`brand.colors\`: named colors (read the names with getBrandKit first and fall back when one is missing). \`brand.palette\` lists them in order.
- Kit screens arrive in \`media\` by their names (\`media.editor\`), loaded like project media; a project image attached with the same name wins.
- \`brand.logo\`: data URL for \`<img src>\`. \`brand.logoSvg\`: the SVG markup when vector; insert it to animate its paths.`,
};

export const blueprintsPage: EditorSkillPage = {
  name: 'blueprints',
  description: 'Product UI that moves: rebuild a kit screen as a blueprint (live HTML with named parts) by measuring it, scoring the rebuild against it, and saving it to the kit; then mount it in scenes and animate its parts. When to use the screenshot instead.',
  body: `# Blueprints: the product's real UI, rebuilt to move

A blueprint is a kit screen rebuilt as a responsive scene module: every piece (header, sidebar, composer, tab, clip, button) is HTML with a \`data-part\` name, measured from the screen's pixels and scored against it. Once saved in the brand kit, every film for that brand can mount it.

## Showing the product
When something inside the UI has to move, use the kit's blueprint or build one (below); when the whole UI just moves or holds, use the screenshot. Real screenshots and screen recordings beat mockups: they show the actual product and build trust. First use the brand kit's screens (getBrandKit); they reach every scene with the kit attached as \`media.<name>\`. Otherwise ask the user for screenshots or short recordings of the screens the script shows (or offer to use ones already in the project's media), upload them, and attach them to scenes as \`media\` (scene-engine, Project media). A recording shows a real interaction; a screenshot with animated HTML on top shows a controlled one. Crop and magnify the part that matters, move a camera over them, tilt them, and layer animated HTML on top (a typed prompt, a highlight, a cursor) to show the action.
Without screenshots, build the UI as HTML mockups in the brand's fonts and colors: windows, inputs, cards, lists, timelines. Show only what the product text describes, with generic sample content.

## Screenshot or blueprint, per shot
Decide shot by shot:
- **The UI moves as a whole** (pan, tilt, zoom, held as a backdrop): use the **screenshot** (\`media.<screen>\`). It is exact and free.
- **Something inside the UI moves** (the composer types, clips slide in, a button is pressed, a panel lifts out): use the **blueprint**.
- Also the blueprint when the shot **zooms deep** (HTML stays sharp, a screenshot blurs past 2x), needs a **size the screenshot lacks**, or shows **changed text** (a different prompt, the user's own content).
- **Mixing is fine:** open on the screenshot and cut to the blueprint when interaction starts; at a 95%+ match the swap is invisible.
If the kit already has a blueprint for that screen (listBlueprints), use it; build one only when it is missing.

## Building one
Fonts and the logo come from the kit; colors and positions come from the screen. Never type a size, color or radius by eye.
1. **Source.** Use an untouched capture from the kit (getBrandKit screens). Never measure an edited screenshot: painting over a badge or cursor also erases what was under it. Ask for a new capture instead.
2. **Measure** with measureScreen: colors at points, and lines across every region (a row across the header, a column down the sidebar, both axes through each button). Each change along a line is an edge. Read every box's **width and height**, not only where it starts, and read corner curves (where the edge reaches the straight side gives the radius). Snap a color to the kit's palette only when they are nearly identical.
3. **Identify the icon set.** Lucide is built in: \`icon('scissors', { size, color })\` returns the real icon. Match a few icons by shape and use Lucide names. Brand logos and app icons come from findIcon (the official SVG), other icons Lucide lacks from findIcon style ui; draw an SVG only for what neither has.
4. **Build** a scene module that takes \`{ root, width, height, brand, media, icon }\` and lays the UI out **responsively**: fixed parts keep their measured size (a sidebar 400px wide, a header 56px tall), regions that stretch take the rest, right-hand items anchor to the right edge, centered things stay centered. Give every meaningful piece \`data-part\`. Use the measured pixels at the screen's size; photos inside the UI (footage, avatars) may be cropped from the screen media.
5. **Compare** with compareScreen (code, at the screen's size). Read the per-part scores, not only the total: a 96% screen can hide a part at 0%. Fix the lowest parts first (look at the red diff image), compare again. Text-heavy parts score lower than flat ones because of anti-aliasing; judge them by the image.
6. **Save** with saveBlueprint (the compare's checkId, a short name, the colors and edges you measured with labels). Aim for 95%+ overall with no flat part (button, panel, divider) under 90%.
7. **Other sizes.** A blueprint renders at any size; check desktop (1920x1080) and laptop (1440x900) with compareScreen width and height when the kit has captures at those sizes; otherwise say those sizes are unverified.

## Using one in a scene
- Attach it: addFilm, addScene or editScene with \`brandKitId\` and \`blueprints: ['Editor']\`.
- Mount it: \`const ui = blueprint('Editor', container, { width: 1600, height: 1000 })\` builds the whole UI inside \`container\` and returns its root. Scale or tilt the container to frame it.
- Animate its parts: \`ui.querySelector('[data-part=composer]')\`. Typical moves: show the whole dashboard, then lift one part out (scale up, shadow, the rest dims); replace a part's content (type a new prompt, swap a clip); transition one part into the next shot; build the UI part by part.
- Keep the blueprint static itself; all motion lives in the scene.`,
};
