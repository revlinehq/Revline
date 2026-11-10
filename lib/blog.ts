type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: string;
  published: string;
  updated: string;
  image: string;
  imageAlt: string;
  featurePath: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const blogPosts = [
  {
    slug: 'one-video-seven-clips-ai-clipping-workflow',
    title: 'One video, seven clips: the AI clipping workflow',
    description: 'Turn a podcast, interview or long video into a focused batch of Shorts and Reels. Find stronger openings, edit each clip and build a repeatable clipping workflow in Revline.',
    category: 'Clipping', published: '2026-11-05T12:00:00Z', updated: '2026-11-05T12:00:00Z',
    image: '/landing/clippers-still.webp', imageAlt: 'A batch of captioned vertical video edits created in Revline', featurePath: '/podcast-clips',
    sections: [
      { heading: 'The next clip might already be in your last recording', paragraphs: [
        'A long interview can contain a useful answer, a surprising disagreement, a short story and a practical demonstration. Each gives someone a different reason to watch. Clipping turns those moments into individual edits, so a recording can do more than sit behind one thumbnail.',
        'Seven clips is a planning target, not a quota. If the source only supports three strong edits, publish three. The goal is a small collection of videos that each deliver something, with enough variety to avoid repeating the same point all week.',
      ] },
      { heading: 'Build a shortlist around seven different promises', paragraphs: [
        'Before opening the editor, name the audience and what they should get from the recording. For a founder interview, your shortlist could include one expensive mistake, a useful tactic, a surprising number with its explanation, a disagreement, an origin story, a clear demonstration and an answer to a common question. Skip any angle the source does not actually support.',
        'In Revline, upload your footage or import a supported public video link. Try: “Find up to seven self-contained clips for first-time founders. Give each a different takeaway, keep the speaker’s meaning and put each accepted clip in its own timeline.” Review the proposed moments before treating them as finished edits.',
      ] },
      { heading: 'Write the hook from what the speaker actually says', paragraphs: [
        'The opening should let a new viewer understand why this moment matters. A concrete line such as “We hired before we had repeat customers” gives the audience a situation immediately. Start close to that line when the surrounding context still makes sense, rather than keeping a long introduction just because it came first in the recording.',
        'Avoid inventing a stronger claim for the on-screen title. If the speaker describes one experience, do not package it as a rule that applies to everyone. Watch the sentences around your chosen opening and ending, and keep the explanation that makes a surprising statement accurate.',
      ] },
      { heading: 'Edit a complete thought, then make it vertical', paragraphs: [
        'Give each clip an opening, enough context and a payoff. Remove false starts and repeated setup, but keep breaths and pauses that make the delivery feel natural. Stop when the idea has landed. A clip does not need a dramatic cut halfway through its answer to encourage another view.',
        'Check the crop throughout the video, especially when speakers move or a demonstration enters the frame. A centered face at the first frame does not establish that the whole edit is framed well. Use a split layout when both speakers matter, and return to one speaker when the extra panel only makes the subject smaller.',
      ] },
      { heading: 'Give the batch one caption style and seven careful reviews', paragraphs: [
        'Choose a consistent font, text size and accent color so the collection looks like it belongs to the same creator. In Revline, describe the caption treatment in the editing conversation. Keep text clear of faces and the space used by platform controls, then inspect the result at phone size.',
        'Consistency does not replace review. Listen for names, numbers and qualifications in every clip. Check caption changes against the actual speech and make sure the last word has time to finish. Watch each exported file with sound and once without sound before uploading it to Shorts, Reels or TikTok.',
      ] },
      { heading: 'Use the next recording to improve the next batch', paragraphs: [
        'After publishing, compare the clips in the platform’s own analytics. Look at where viewers leave, which subjects invite useful comments and whether a clip brings people toward the longer recording. Compare similar videos and give them comparable time to find an audience; one early view count is a weak basis for redesigning the whole workflow.',
        'Carry one specific lesson into your next brief. Ask for clearer openings, fewer overlapping ideas or more examples, depending on what you observed. Keep the reviewed Revline timelines for later adjustments. AI can help you find and assemble candidates; good selection and a final human review still decide what deserves to be published.',
      ] },
    ],
  },
  {
    slug: 'turn-podcasts-into-short-clips',
    title: 'How to turn a podcast into short clips without losing the point',
    description: 'A practical workflow for choosing self-contained podcast moments, tightening cuts, reviewing captions and preparing a vertical edit in Revline.',
    category: 'Clipping', published: '2026-11-05T12:00:00Z', updated: '2026-11-05T12:00:00Z',
    image: '/landing/clippers-still.webp', imageAlt: 'Revline clipping workflow with editable vertical video clips', featurePath: '/podcast-clips',
    sections: [
      { heading: 'Choose a complete thought before choosing a duration', paragraphs: [
        'A useful podcast clip answers a question, explains an idea or tells a small story that someone can understand without hearing the previous ten minutes. Start by identifying that thought. A dramatic sentence can make an opening, but it can also misrepresent the speaker if its explanation disappears.',
        'Listen to the sentence before and after each candidate. Check who pronouns refer to, whether a claim has an important qualification and whether the clip reaches a conclusion. Keep context when removing it would change the meaning. There is no reason to force every idea into the same length.',
      ] },
      { heading: 'Give the editor a specific selection brief', paragraphs: [
        'Bring your recording into Revline and describe the audience and subject. A request such as “Find three self-contained clips about the first year of running a business” gives the editor a clearer target than “Make this viral.” Include any speakers, topics or sections you want to leave out.',
        'Revline can use saved transcript evidence to identify candidates and place accepted clips in separate timeline tabs. Treat that selection as a draft. Review the actual source around each boundary before deciding which clips to publish. AI selection does not establish that a claim is correct or that a moment will perform well.',
      ] },
      { heading: 'Tighten the cut while preserving the delivery', paragraphs: [
        'Remove abandoned starts and accidental repetitions when they make the idea harder to follow. Keep pauses that give an answer room to land. Cutting every silence can make a thoughtful explanation sound rushed and can leave unnatural changes in breath or expression.',
        'Play the edit with sound rather than judging only the transcript. Check the first and last words for clipped consonants. If a visual cut is distracting, adjust the boundary or use a different source section before adding decoration.',
      ] },
      { heading: 'Check the vertical version as a finished video', paragraphs: [
        'When making a vertical version, inspect where the speaker sits in the frame. Ask for reframing or a split layout when the recording needs it, then check that the requested crop keeps faces and important objects visible. A podcast layout does not always need two speakers on screen at once.',
        'Review captions for names, numbers and punctuation. Watch the exported file on a phone to check text size, sound and the final frame. Publish only recordings and assets you have permission to use. Save the editable timeline so the next version starts from your reviewed cut.',
      ] },
    ],
  },
  {
    slug: 'review-ai-video-captions',
    title: 'A practical checklist for reviewing AI video captions',
    description: 'Check wording, timing, contrast and framing before publishing captioned video. Learn what to review after automatic transcription in Revline.',
    category: 'Captions', published: '2026-11-05T12:00:00Z', updated: '2026-11-05T12:00:00Z',
    image: '/landing/animated-captions-poster.webp', imageAlt: 'An example of styled video captions in Revline', featurePath: '/ai-video-captions',
    sections: [
      { heading: 'Correct the transcript before styling it', paragraphs: [
        'Automatic captions are a first draft of what was said. A fluent-looking sentence can still contain the wrong name, number or technical term. Listen to the recording while reviewing the text, especially when speakers overlap, music is loud or the subject uses unfamiliar vocabulary.',
        'Keep a short list of important names and terms next to the edit. Check them consistently across the video. When speech is unclear, revisit the audio rather than replacing it with a plausible guess. Captions should represent the recording, including qualifications that matter to the speaker’s meaning.',
      ] },
      { heading: 'Group words into readable phrases', paragraphs: [
        'Watch the captions at normal playback speed. Each phrase needs enough time to be read without continuing long after the speaker has moved on. Break a long sentence at a natural phrase boundary instead of leaving a large block of text that competes with the picture.',
        'In Revline, ask for the caption style you want in the editing conversation and then review the result on the timeline. A useful starting request is “Add minimal captions with no background, and keep them away from the speaker’s face.” Adjust the wording or timing when the first pass does not fit the footage.',
      ] },
      { heading: 'Choose contrast that works throughout the shot', paragraphs: [
        'White text can look clear on one frame and disappear when a bright object moves behind it. Inspect several points in a shot, especially during camera movement or transitions. A restrained outline, shadow or background may improve readability when plain text is not enough.',
        'Use a consistent hierarchy. An accent color can identify a meaningful word, but changing every word’s appearance creates more work for the viewer. Match the style to the video’s purpose rather than adding animation just because it is available.',
      ] },
      { heading: 'Review the actual output at phone size', paragraphs: [
        'Keep subtitles clear of faces and important demonstrations. Leave space for the interface of the platform where the video will appear. Previewing at a narrow width helps reveal lines that wrap awkwardly or type that looked larger in the editor than it will on a phone.',
        'Export a captioned version and watch it from beginning to end with sound, then once with sound off. Check the opening, names and numbers, rapid speech and the last caption. Text that is correct in the editor can still be uncomfortable to read at the final size, so judge the delivered video too.',
      ] },
    ],
  },
] satisfies BlogPost[];

export function readingMinutes(post: BlogPost) {
  const words = post.sections.flatMap(section => [section.heading, ...section.paragraphs]).join(' ').trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function blogDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
