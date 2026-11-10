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

