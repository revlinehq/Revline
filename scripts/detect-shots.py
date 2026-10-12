"""Return source-frame shot boundaries; never transcode or split the uploaded file."""
import json
import sys

import cv2
from scenedetect import AdaptiveDetector, SceneManager, open_video

cv2.setNumThreads(1)
video = open_video(sys.argv[1])
manager = SceneManager()
manager.add_detector(AdaptiveDetector(min_scene_len=3))
# Inspect every frame; spatial downscaling keeps CPU use reasonable.
manager.detect_scenes(video, frame_skip=0, show_progress=False)
scenes = manager.get_scene_list(start_in_scene=True)
print(json.dumps({
    "fps": float(video.frame_rate),
    "shots": [{
        "start": start.seconds, "end": end.seconds,
        "startFrame": start.frame_num, "endFrame": end.frame_num,
    } for start, end in scenes],
}))
