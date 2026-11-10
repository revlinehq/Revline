# Changelog fragments

Every pull request adds one file here, `<YYYY-MM-DD>-<slug>.md`, holding its entry or entries:

```
- <System>: <what changed>. Why: <reason>.
```

Never edit `docs/changelog.md` in a pull request: two pull requests that both add a line under today's heading
conflict, and GitHub does not honour `merge=union` when it decides whether a pull request can merge.
`npm run release:prod` runs `node scripts/changelog.mjs build`, which moves the fragments into `docs/changelog.md`
under their dates and commits the result. `node scripts/changelog.mjs check` validates the files (CI runs it).
