export const marketingPages = [
  {
    slug: 'podcast-clips', title: 'AI podcast clip maker',
    description: 'Turn a long podcast into short clips with Revline. Find moments, edit the cuts, add captions and reframe for vertical video.',
    heading: 'Turn your podcast into clips worth sharing.',
    intro: 'Give a long conversation a second life. Ask Revline to find useful moments, then review each clip in an editable timeline before publishing.',
    steps: [
      { title: 'Bring the conversation', text: 'Upload your recording or import a supported public video link. Revline uses saved speech evidence to help find candidate moments.' },
      { title: 'Choose what matters', text: 'Describe the topics, audience and number of clips you want. Ask for a strong opening while keeping the speaker’s meaning intact.' },
      { title: 'Make each clip yours', text: 'Review cuts, correct captions and choose framing. Each accepted clip has its own timeline so you can refine it before export.' },
    ],
    prompt: 'Find three self-contained clips about building a business. Keep the speaker’s meaning, add minimal captions and give each clip its own timeline.',
    note: 'Clip selection is a starting point. Review context, names, caption accuracy and permissions before sharing someone else’s recording.',
  },
  {
    slug: 'ai-video-captions', title: 'AI video captions and subtitle editor',
    description: 'Add and edit video captions with Revline. Review the transcript, adjust subtitle timing and style, then export your captioned video.',
    heading: 'Captions that follow your words.',
    intro: 'Ask for subtitles in the same conversation you use to edit your video. Keep the result editable so wording, timing and appearance stay under your control.',
    steps: [
      { title: 'Start with your footage', text: 'Upload a spoken video or open an existing edit. Revline uses the available transcript and audio evidence for caption work.' },
      { title: 'Say how captions should look', text: 'Request a simple subtitle style, a different font or a specific accent color. Match the format to your audience and frame.' },
      { title: 'Review before exporting', text: 'Check names, punctuation and reading speed. Refine the captions on the timeline and export them as part of your video.' },
    ],
    prompt: 'Caption this video with clean white text and no background. Keep captions clear of the speaker’s face and let me review the wording.',
    note: 'Speech recognition can miss words, especially with background noise or unfamiliar names. Always check the transcript before publishing.',
  },
  {
    slug: 'reference-video-recreation', title: 'Reference video recreation with AI',
    description: 'Recreate a reference video as editable motion scenes in Revline. Inspect frames, measure movement and compare your rendered edit with the source.',
    heading: 'Rebuild the motion. Keep the layers editable.',
    intro: 'Use a reference to explain the timing and visual language you want. Revline can build editable motion scenes and compare the rendered result with that reference.',
    steps: [
      { title: 'Inspect the reference', text: 'Read frames around transitions and inspect details at full resolution. Identify typography, composition and the assets needed for the recreation.' },
      { title: 'Measure and rebuild', text: 'Motion tools estimate camera movement, element paths, timing and easing. Build the result from editable scenes, using your own or licensed assets.' },
      { title: 'Compare the result', text: 'Compare rendered frames and motion with the source. Refine differences and record what remains approximate or could not be measured.' },
    ],
    prompt: 'Recreate this product launch video with editable scenes. Match its composition, transition timing and easing, then compare the render against the reference.',
    note: 'Recreation is not guaranteed to be pixel-perfect. Tracking can be uncertain with overlapping objects, perspective changes and complex effects. Use references you have permission to reproduce.',
  },
];
