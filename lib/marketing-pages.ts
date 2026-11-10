export const marketingPages = [
  {
    slug: 'podcast-clips', navigationLabel: 'Podcast clips', title: 'AI podcast clip maker',
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
    slug: 'ai-video-captions', navigationLabel: 'Captions', title: 'AI video captions and subtitle editor',
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
];
