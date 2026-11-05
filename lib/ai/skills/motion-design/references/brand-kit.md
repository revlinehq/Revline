---
name: "brand-kit"
description: "First for a new film for the user's own brand: find, create and confirm the brand kit (fonts, colors, logo, screens, product text), and how scenes use it. Not used when recreating a given video."
---
# Brand kit

A brand kit is a named, saved brand for this user: colors, font files, a logo, the landing-page copy, the product text (what it is, the problem it solves, the features worth showing), and saved product screens. Scenes attach it with `brandKitId` and receive it as `brand`.

Not for recreating a video the user gave: a clone takes its brand from the video's own frames, with no kit and no questions (motion-design, "Recreating a video").

## Workflow
1. **Check first.** listBrandKits.
   - One kit clearly fits: ask "Use the <name> brand kit for this video?" and wait.
   - Several fit: name them and ask which.
   - None: ask for the website URL, or for a theme (colors, Google Fonts names, logo SVG) if there is no site.
2. **Create.** createBrandKit with the URL (and any theme values the user gave; those win). Name it after the brand.
3. **Show what was found.** Fonts by role, the main colors, whether a logo was found, and every note. Ask the user to correct anything wrong; fix it with updateBrandKit. Never pretend a missing piece was found.
4. **Confirm the product, only when the film states product facts the user has not given.** Draft one product text from the scraped copy: what it is, the problem it solves and the 3 to 5 features worth showing (features as short lines). Show it and ask the user to correct it, asking only about what the copy does not answer. Save the confirmed text with updateBrandKit context.product. Never build on an unconfirmed product text.
5. **Screens, only when the user wants their product UI shown.** Product screenshots belong to the brand, not one project. Check the kit's screens (getBrandKit). When the user gives screenshots, offer to save them to the kit (updateBrandKit addScreens, named like editor, dashboard, settings, with a short note) so every later video reuses them without re-uploading.
6. **Use.** Pass `brandKitId` to addFilm or addScene (or editScene to attach or refresh). A scene keeps the kit as it was when saved.

## In scene code
`brand` is null without a kit. With one:
- `brand.fonts.heading`, `brand.fonts.body`: loaded family names. `font-family:'${brand.fonts.heading}'`.
- `brand.colors`: named colors (read the names with getBrandKit first and fall back when one is missing). `brand.palette` lists them in order.
- Kit screens arrive in `media` by their names (`media.editor`), loaded like project media; a project image attached with the same name wins.
- `brand.logo`: data URL for `<img src>`. `brand.logoSvg`: the SVG markup when vector; insert it to animate its paths.