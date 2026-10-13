"""Return source-frame shot boundaries; never transcode or split the uploaded file."""
import json
import math
import subprocess
import sys

import cv2
from scenedetect import AdaptiveDetector, FrameTimecode, SceneManager
from scenedetect.backends.opencv import VideoStreamCv2


class IndexedVideo(VideoStreamCv2):
    """Give the detector decoded frame indices, not VFR PTS converted using average FPS."""
    @property
    def position(self):
        return FrameTimecode(max(0, self.frame_number - 1), fps=self.frame_rate)


class CountingDetector(AdaptiveDetector):
    inspected_frames = 0

    def process_frame(self, timecode, frame_img):
        self.inspected_frames += 1
        return super().process_frame(timecode, frame_img)


source = sys.argv[1]
probe = subprocess.run([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "format=start_time:stream=nb_frames:frame=best_effort_timestamp_time,duration_time,pkt_duration_time",
    "-of", "json", source,
], capture_output=True, text=True, check=True, timeout=60)
if probe.stderr.strip():
    raise RuntimeError("The video has frame decoding errors; complete shot coverage cannot be verified.")
metadata = json.loads(probe.stdout)
frames = metadata.get("frames", [])
if not frames:
    raise RuntimeError("No video frames decoded.")
origin = float(metadata.get("format", {}).get("start_time", 0))
timestamps = [float(frame["best_effort_timestamp_time"]) - origin for frame in frames]
if any(not math.isfinite(time) or time < -1e-6 or (index and time <= timestamps[index - 1]) for index, time in enumerate(timestamps)):
    raise RuntimeError("Video presentation timestamps are not increasing.")
timestamps = [max(0, time) for time in timestamps]
declared_count = metadata.get("streams", [{}])[0].get("nb_frames")
if declared_count not in (None, "N/A") and int(declared_count) != len(frames):
    raise RuntimeError("The video did not decode its declared number of frames.")

cv2.setNumThreads(1)
video = IndexedVideo(source)
manager = SceneManager()
detector = CountingDetector(min_scene_len=3)
manager.add_detector(detector)
# Inspect every frame; spatial downscaling keeps CPU use reasonable.
inspected = manager.detect_scenes(video, frame_skip=0, show_progress=False)
scenes = manager.get_scene_list(start_in_scene=True)
if inspected != len(frames) or detector.inspected_frames != len(frames) or not scenes or scenes[0][0].frame_num != 0 or scenes[-1][1].frame_num != len(frames):
    raise RuntimeError("Shot detection did not inspect every decoded video frame.")
last_duration = float(frames[-1].get("duration_time", frames[-1].get("pkt_duration_time", 0)))
if not math.isfinite(last_duration) or last_duration <= 0:
    last_duration = timestamps[-1] - timestamps[-2] if len(frames) > 1 else 1 / float(video.frame_rate)
end_time = timestamps[-1] + last_duration
print(json.dumps({
    "fps": float(video.frame_rate),
    "sourceTiming": {"basis": "pts", "videoStart": timestamps[0], "videoEnd": end_time, "frameCount": len(frames)},
    "shots": [{
        "start": timestamps[start.frame_num],
        "end": timestamps[end.frame_num] if end.frame_num < len(frames) else end_time,
        "startFrame": start.frame_num, "endFrame": end.frame_num,
    } for start, end in scenes],
}))
