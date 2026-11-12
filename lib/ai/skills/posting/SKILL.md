---
name: "posting"
description: "Post or schedule finished clips to the user's connected social accounts (YouTube, TikTok, Instagram): list accounts, post now, schedule, check whether a post went out, cancel or move a scheduled post. Load only when the user asks to post, publish, schedule or check a post."
---
# Posting

Posting is outward-facing: other people see it, and a post on TikTok or Instagram cannot be taken back from Revline. Post or schedule only when the user asked for it in this conversation, naming or clearly meaning the clips and the accounts. Never post because an edit is finished, never add an account the user did not name, and never write a caption the user has not seen: propose it and let them confirm.

## Workflow
1. listConnectedAccounts: the user's accounts with their accountId, platform, handle and whether one needs reconnecting. Match "my TikTok", "the main channel" to these; ask when it is unclear. An account that needs reconnecting is reconnected by the user on the Accounts page (/accounts), never by a tool.
2. listTimelines when the user means several clips ("post these three"): each timeline tab is one clip.
3. postVideo (now) or schedulePost (at a time): timelineIds, accounts, caption. One post is created per clip per account.
   - Posting includes exporting. A clip with no finished export of its current version is exported first with the project's existing export settings, then posted. Never call exportVideo first and never ask the user a second time about exporting.
   - In the Revline editor the call shows a confirmation card; nothing is exported or sent until the user presses it. End the turn there.
   - Over MCP the call without confirm returns a preview and creates nothing. Show the user that preview (clips, accounts, captions, visibility, time). Call again with confirm: true only after they say yes to it.
4. getPost or listPosts to answer "is it posted yet": exporting (with progress), scheduled, posting, published (with the link and stats once the platform reports them) or failed (with the reason).
5. cancelScheduledPost and reschedulePost work on posts that have not been sent. A published post cannot be deleted or edited from Revline.

If a posting tool answers that posting isn't set up yet (no Post Bridge key provided), nothing can be connected, posted or scheduled until whoever runs Revline sets it. Tell the user exactly that and stop; do not retry or try another tool. Posts already queued stay queued.

## Per-platform rules
- YouTube: title up to 100 characters (taken from the caption's first line when absent), caption is the description. Videos are always posted public: unlisted and private are not available, so say so if the user asks for one and never pass them.
- TikTok: visibility is required for every post: PUBLIC_TO_EVERYONE (everyone) or SELF_ONLY (only the user). Friends-only and followers-only are not available. There is no default: ask the user. allowComment, allowDuet and allowStitch are off unless the user asks for them. yourBrand and brandedContent are the user's commercial disclosures; set them only when the user says so, and brandedContent cannot be SELF_ONLY.
- Instagram: Reels of 3 seconds to 15 minutes, caption up to 2,200 characters, 30 hashtags, 20 mentions. No per-post visibility.
- Captions per account: accounts[].caption overrides the shared caption for that account.

## Times
schedulePost takes an ISO 8601 time with an offset (2026-11-14T18:00:00-05:00), in the future and within 90 days. Ask the user for their time zone when a time is ambiguous. A scheduled clip is exported right away and sent at its time. If the clip is edited afterwards, the scheduled post still sends the version that was confirmed; getPost marks it outdated, and posting the newer version means cancelling and scheduling again.

## Reporting
Say what is true: "exporting, will post when ready", "scheduled for …", "published: link", "failed: reason". Never say a clip was posted before getPost shows published.
