# Intentional contract changes

`scripts/compat-check.mjs` runs on every pull request and fails when a change would break something already
shipped: a public Convex function the iOS app calls (installed builds cannot be updated by a deploy), a media
processor capability the deployed processor may not have, or a table, index or field in `convex/schema.ts`.

When a break is intended, add one line below in the same pull request, naming the item exactly as the check prints
it and why it is safe. Only a line added in that pull request counts, so each break is reviewed on its own; older
lines stay as the record.

```
- `projects:list`: <why installed iOS builds are not affected>
- `schema:projects.by_owner`: <why no deployed function or stored row depends on it>
- `capability:read:looks`: <why Convex does not need to check the processor first>
```

## Changes

- `schema:filmDrafts`: motion films were removed (2026-11-10); the functions that wrote and read film drafts are deleted in the same change, and rows only lived while a film was being written.
- `schema:sceneCode`: scene and film clips no longer render; nothing loads scene code by hash any more. Old scene clips keep their `codeRef` and draw nothing.
- `schema:sceneThumbnails`: scene thumbnails were only shown on scene clips, which are no longer supported; `convex/sceneThumbs.ts` is deleted in the same change.
- `schema:blueprintChecks`: blueprints were removed with motion films; no function queues or reads a blueprint check.
- `schema:blueprints`: blueprints were removed with motion films; `convex/blueprints.ts` is deleted in the same change.
- `schema:mediaTasks.blueprintCheckId`: the `blueprintChecks` table is gone, so the id validator became a string; stored ids are strings and still validate, and nothing reads the field.
- `schema:iconCache`: only `findIcon` (film logos and icons) used it; the tool and `convex/icons.ts` are deleted in the same change.
- `schema:referenceMotionCoverage`: reference recreation was removed; `convex/referenceMotion.ts` is deleted in the same change.
- `schema:referenceMotionOff`: reference recreation was removed; `convex/referenceMotion.ts` is deleted in the same change.
- `schema:referenceMotionChecks`: reference recreation was removed; `convex/referenceMotion.ts` is deleted in the same change.
- `schema:comparisonContinuations`: only `compareReference` used it; the tool is deleted in the same change.
