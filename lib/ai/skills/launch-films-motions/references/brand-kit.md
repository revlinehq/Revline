---
name: "brand-kit"
description: "Finds, creates and confirms the user's brand kit (fonts, colors, logo, screens, product text) and documents the `brand` object films receive. Read first for a new film for the user's own brand; not used when recreating a reference."
---
# Brand kit

A good kit is confirmed by the user: the right fonts by role, the main colors, the logo, and (only when needed) a confirmed product text and saved product screens. Films attach it with `brandKitId` and receive it as `brand`.

A recreation takes its brand from the reference's own frames, with no kit and no questions.

## Workflow
1. **Check first.** listBrandKits.
   - One kit clearly fits: ask "Use the <name> brand kit for this film?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL. If there is no site, ask for a theme (colors, Google Fonts names, logo SVG).
2. **Create.** createBrandKit with the URL and any theme values the user gave (those win). Name it after the brand.
3. **Show what was found:** fonts by role, the main colors, whether a logo was found, and every note. Ask the user to correct anything wrong; fix it with updateBrandKit.
4. **Confirm the product**, only when the film states product facts the user has not given (step details under Rules).
5. **Screens**, only when the user wants their product UI shown. Check the kit's screens with getBrandKit.
6. **Use.** Pass `brandKitId` to addFilm or addScene, or to editScene to attach or refresh it.

## Rules
- Never pretend a missing piece was found.
- **Product text:** draft one from the scraped copy: what it is, the problem it solves and 3 to 5 features worth showing, as short lines.
- Show it and ask the user to correct it, asking only about what the copy does not answer. Save the confirmed text with updateBrandKit context.product.
- Never build on an unconfirmed product text.
- **Screens belong to the brand, not one project.** When the user gives screenshots, offer to save them to the kit (updateBrandKit addScreens, named like editor, dashboard, settings, with a short note) so later films reuse them.

## In scene code
`brand` is null without a kit. With one:
- `brand.fonts.heading`, `brand.fonts.body`: loaded family names.
- `brand.colors`: named colors. Read the names with getBrandKit first and fall back when one is missing. `brand.palette` lists them in order.
- `brand.logo`: a data URL for `<img src>`. `brand.logoSvg`: the SVG markup when the logo is vector; insert it to animate its paths.
- Kit screens arrive in `media` by name (`media.editor`), loaded like project media. A project image attached with the same name wins.

## Example
```ts
const heading = brand?.fonts.heading ?? 'Inter';   // fall back when there is no kit
root.innerHTML = `<div class="logo">${brand?.logoSvg ?? ''}</div><h1 style="font-family:'${heading}'">Ship faster</h1>`;
```
