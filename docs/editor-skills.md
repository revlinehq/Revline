# Editor skill authoring

Author prose under `lib/ai/skills/<skill>/SKILL.md` and `references/*.md`. Each document starts with `name` and `description` as JSON-quoted YAML strings. TypeScript adapters preserve registry order, shared pages, page names and live expansion.

Run `npm run skills:bundle` after Markdown edits, and commit `documents.generated.ts` with its sources. Generation sorts paths, preserves body whitespace and writes only changed output. `npm run skills:check` rejects stale bundles; typecheck and build run that gate. Committed output supports direct Convex, worker and server deployment from clean checkouts without runtime filesystem access, downloads or storage. Explicit generation keeps release validation from dirtying the checkout.

`{{revline:0}}`, `{{revline:1}}`, etc. are positional slots supplied by the adjacent TypeScript adapter, not executable Markdown. Keep them aligned with its arguments. Fonts, plugins, starter code, audio limits, grading choices, effect rules and the lazy effects catalog still use live runtime modules. Replacement runs once so inserted code and example template literals remain literal. The readSkill interface and capability loading are unchanged.

## Recreation guidance provenance

Reviewed November 4, 2026: HeyGen Hyperframes [reverse-any-video](https://github.com/heygen-com/hyperframes/blob/main/skills/reverse-any-video/SKILL.md) and [references/match.md](https://github.com/heygen-com/hyperframes/blob/main/skills/reverse-any-video/references/match.md), under its [Apache-2.0 license](https://github.com/heygen-com/hyperframes/blob/main/LICENSE) (Copyright 2026 HeyGen, Inc.). Recreation guidance independently paraphrases the measurement concepts; no upstream code, recipes or prose is copied. Revline's tools, modes and footage workflows remain authoritative. No Hyperframes commands, billing, telemetry or reshoot workflow is adopted.
