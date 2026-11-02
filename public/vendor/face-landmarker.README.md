# MediaPipe Face Landmarker

Pinned Google MediaPipe Face Landmarker float16 bundle, version 1. Used only by the media processor for local mouth-opening measurements; no Gemini API call or key is involved.

Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

Model documentation and model cards: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker#models

Both container targets copy the vendored assets. The processor runtime check requires this bundle and `scripts/detect-facecam.py`; export workers load only the resulting crop paths and streamed pixel tracks.
