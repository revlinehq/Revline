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
  {
    slug: 'recreate-reference-video-motion',
    title: 'How to study a reference video’s timing and easing',
    description: 'Go beyond matching still frames: inspect transitions, separate camera and object movement, measure easing and compare an editable recreation in Revline.',
    category: 'Motion design', published: '2026-11-05T12:00:00Z', updated: '2026-11-05T12:00:00Z',
    image: '/landing/revline-launch-poster.webp', imageAlt: 'A Revline motion film built from editable scene elements', featurePath: '/reference-video-recreation',
    sections: [
      { heading: 'Make an inventory of what actually changes', paragraphs: [
        'A reference recreation starts with observation. Write down the sections of the film, what appears in each one and how each section enters and leaves. Record the source dimensions, frame rate and duration so your build uses the same starting conditions.',
        'A few screenshots can show composition, but they cannot establish whether a transition is a cut, a short slide or a move with overshoot. Inspect consecutive frames around each change. Use full-resolution frames or crops to read small typography and shape details rather than estimating them from a contact sheet.',
      ] },
      { heading: 'Separate camera movement from object movement', paragraphs: [
        'If a panel grows while the background stays fixed, the panel may be scaling on its own. If everything moves together, a shared camera move is a possibility. A foreground layer or wipe can also dominate the visible motion, so a measured shift does not automatically prove that the whole scene’s camera moved.',
        'Revline’s motionMap tool reports candidate motion and timing. Use trackReference on background and foreground regions separately when they behave differently. Compare the measurements with the actual frames before applying a global camera transform to every layer.',
      ] },
      { heading: 'Measure the arrival as carefully as the start', paragraphs: [
        'Easing describes how progress changes through a move. Two objects can start and end in the same positions at the same times yet feel different because one accelerates slowly and the other arrives with a bounce. Look for the onset, acceleration, peak movement, overshoot and final settle.',
        'Use the measured easing as a starting point for an editable scene. Do not replace every move with the same convenient curve. When tracking is uncertain because an object changes shape, turns in perspective or passes behind another object, inspect a shorter window and describe what remains approximate.',
      ] },
      { heading: 'Compare the rendered recreation with the source', paragraphs: [
        'Render the current saved revision and align it with the reference. Compare both still frames and movement. A good still-frame match does not establish that entrances, cuts or caption switches happen at the right times. Check the boundaries between sections after making timing changes.',
        'In Revline, compareReference helps inspect rendered appearance and compareMotion helps identify motion differences. Refine the mismatch and recheck the changed window. Record substituted assets, fonts and unmeasured intervals honestly. Use your own or licensed assets and references you have permission to reproduce.',
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
