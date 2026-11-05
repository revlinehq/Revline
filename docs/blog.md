# Editing the blog

Articles live in `lib/blog.ts`. Each entry contains a stable slug, title, description, category, publication and modification dates, a cover image with alt text, a related feature link, and sections of paragraphs.

Adding an entry creates its article page and adds it to the blog index, RSS feed and sitemap during the next build. No separate publishing service or scheduled content generator is required.

- Write a useful guide based on supported product behavior. Check factual claims and links before publishing.
- Use a publication date that reflects the actual release. Change `updated` only when the article changes substantially.
- Keep slugs stable so existing links continue working.
- Use images you have permission to publish and describe what they show.
- Keep authorship and AI assistance disclosures accurate.

Pages produce canonical URLs, article sharing metadata, BlogPosting and breadcrumb structured data. Google decides whether and how to display enhancements; markup does not guarantee indexing or rankings.

Run `npm run typecheck` and `npm run build`, then inspect the article and RSS feed in the running app before opening a pull request.
