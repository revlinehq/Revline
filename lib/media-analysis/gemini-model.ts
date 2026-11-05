/** The Gemini model for video analysis; GEMINI_VIDEO_MODEL overrides it per deployment. */
export function geminiVideoModel() {
  return process.env.GEMINI_VIDEO_MODEL || 'gemini-3.7-flash';
}

/** The Gemini model for still-frame analysis; GEMINI_FRAME_MODEL overrides the video model. */
export function geminiFrameModel() {
  return process.env.GEMINI_FRAME_MODEL || geminiVideoModel();
}
