"""Stream source audio once through YAMNet and rolling energy, bounded RAM.

Visual evidence is measured only inside locally detected, continuous face boxes.
Whole-frame change supplies coarse shot boundaries, never highlight strength.
"""
import collections
import json
import math
import os
import subprocess
import sys
import zipfile

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

cv2.setNumThreads(2)
SOURCE, MODEL, DURATION = sys.argv[1], sys.argv[2], float(sys.argv[3])
EVENTS = {
    'Laughter': 'laughter', 'Giggle': 'laughter', 'Snicker': 'laughter',
    'Belly laugh': 'laughter', 'Chuckle, chortle': 'laughter',
    'Screaming': 'shouting', 'Shout': 'shouting', 'Yell': 'shouting',
    'Cheering': 'cheering', 'Applause': 'applause', 'Clapping': 'applause',
    'Music': 'music',
}


def emit_signal(signals, start, end, kind, strength, detail):
    # Merge adjacent classifier observations, keeping the actual reaction tail.
    for item in reversed(signals[-16:]):
        if item['kind'] == kind and 0 <= start - item['end'] <= .55:
            item['end'] = round(end, 3)
            item['strength'] = max(item['strength'], round(max(0, min(1, strength)), 3))
            return
    signals.append(dict(start=round(start, 3), end=round(end, 3), kind=kind,
                        strength=round(max(0, min(1, strength)), 3), detail=detail))


def audio_tracks():
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                                                '-show_entries', 'stream=duration,start_time', '-of', 'json', SOURCE], timeout=30))
    stream = (probe.get('streams') or [{}])[0]
    try:
        expected = min(DURATION, float(stream.get('start_time', 0)) + float(stream['duration']))
    except (KeyError, ValueError):
        expected = DURATION
    interpreter = Interpreter(model_path=MODEL, num_threads=2)
    interpreter.allocate_tensors()
    inp, out = interpreter.get_input_details()[0], interpreter.get_output_details()[0]
    size = int(np.prod(inp['shape']))
    with zipfile.ZipFile(MODEL) as archive:
        labels = archive.read('yamnet_label_list.txt').decode().splitlines()
    classes = [(i, EVENTS[label]) for i, label in enumerate(labels) if label in EVENTS]
    # Choose the louder channel per patch, avoiding anti-phase cancellation.
    process = subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-i', SOURCE,
                                '-map', '0:a:0', '-vn', '-af', 'aresample=16000:async=1:first_pts=0',
                                '-ac', '2', '-f', 'f32le', '-'], stdout=subprocess.PIPE)
    levels, signals, history = [], [], collections.deque(maxlen=120)
    samples, pending = 0, np.empty(0, dtype=np.float32)
    try:
        while True:
            raw = process.stdout.read(size * 2 * 4)
            if not raw:
                break
            stereo = np.frombuffer(raw[:len(raw) - len(raw) % 8], dtype='<f4').reshape(-1, 2)
            if not len(stereo):
                break
            chunk = stereo[:, int(np.argmax(np.sum(stereo * stereo, axis=0)))]
            start, end = samples / 16000, min(DURATION, (samples + len(chunk)) / 16000)
            pending = np.concatenate((pending, np.max(stereo * stereo, axis=1)))
            while len(pending) >= 8000:
                rms = 10 * math.log10(max(1e-12, float(np.mean(pending[:8000]))))
                at = len(levels) * .5
                baseline = float(np.median(history)) if len(history) >= 10 else rms
                if len(history) >= 10:
                    if rms > baseline + 7 and rms > -45:
                        emit_signal(signals, at, at + .5, 'spike', (rms - baseline) / 18,
                                    f'{rms:.1f} dB RMS; rolling baseline {baseline:.1f} dB')
                    if rms < baseline - 16 and baseline > -50:
                        emit_signal(signals, at, at + .5, 'silence', (baseline - rms) / 30,
                                    f'Sudden quiet relative to {baseline:.1f} dB baseline')
                    if len(levels) >= 12 and rms - np.median(levels[-12:-8]) / 10 > 6 and rms > baseline + 3:
                        emit_signal(signals, max(0, at - 6), at + .5, 'build', (rms - baseline) / 14,
                                    'Energy builds over six seconds against rolling baseline')
                levels.append(round(rms * 10))
                history.append(rms)
                pending = pending[8000:]
            padded = np.pad(chunk, (0, size - len(chunk))) if len(chunk) < size else chunk
            interpreter.set_tensor(inp['index'], padded.reshape(inp['shape']).astype(np.float32))
            interpreter.invoke()
            scores = interpreter.get_tensor(out['index']).reshape(-1)
            grouped = {}
            for index, kind in classes:
                grouped[kind] = max(grouped.get(kind, 0), float(scores[index]))
            for kind, confidence in grouped.items():
                if confidence >= (.55 if kind == 'music' else .25):
                    emit_signal(signals, start, end, kind, confidence, f'YAMNet CPU {kind}: {confidence:.2f}')
            samples += len(chunk)
        if process.wait() != 0:
            raise RuntimeError('ffmpeg could not decode the complete audio track')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
    # Continuous background music is not a sting/highlight signal.
    signals = [s for s in signals if s['kind'] != 'music' or s['end'] - s['start'] <= 6]
    return levels, signals, samples / 16000, expected


def visual_tracks():
    width, height, step = 480, 270, 2
    cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
    cascade = cv2.CascadeClassifier(cascade_path)
    process = subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '2', '-skip_frame', 'nokey', '-i', SOURCE,
                                '-an', '-vf', f'fps=1/{step},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                                '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    signals, previous, previous_regions, previous_crops, count = [], None, [], [], 0
    try:
        while True:
            raw = process.stdout.read(width * height)
            if not raw:
                break
            if len(raw) != width * height:
                raise RuntimeError('Incomplete visual sample')
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width)
            at = count * step
            cut = False
            if previous is not None and np.mean(cv2.absdiff(frame, previous)) > 30:
                a = cv2.calcHist([frame], [0], None, [64], [0, 256])
                b = cv2.calcHist([previous], [0], None, [64], [0, 256])
                cv2.normalize(a, a, alpha=1, norm_type=cv2.NORM_L1)
                cv2.normalize(b, b, alpha=1, norm_type=cv2.NORM_L1)
                cut = cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA) > .55
            if cut:
                signals.append(dict(start=at, end=at, kind='cut', strength=.5,
                                    detail='Coarse scene change, two-second sampling; structure only'))
                previous_regions, previous_crops = [], []
            # Re-detect each sample: an old face box must never become a
            # gameplay/background motion detector when the face moves away.
            regions = sorted(cascade.detectMultiScale(frame, 1.1, 5, minSize=(18, 18)), key=lambda r:r[2]*r[3], reverse=True)[:4]
            crops = [cv2.resize(frame[y:y+h, x:x+w], (32, 32)) for x,y,w,h in regions]
            if not cut:
                for (x,y,w,h), after in zip(regions, crops):
                    matches = [(math.hypot(x+w/2-a-c/2,y+h/2-b-d/2),before)
                               for (a,b,c,d),before in zip(previous_regions,previous_crops)
                               if .65 < w/c < 1.55 and .65 < h/d < 1.55]
                    if not matches:
                        continue
                    distance,before=min(matches,key=lambda m:m[0])
                    if distance > max(w,h)*.6:
                        continue
                    delta = float(np.mean(cv2.absdiff(before, after))) / 255
                    if delta > .12:
                        emit_signal(signals, max(0, at-step), at, 'reaction', min(1, delta/.35),
                                    f'Change inside detected face only; box {x/width:.3f},{y/height:.3f},{w/width:.3f},{h/height:.3f}; not emotion recognition')
            previous, previous_regions, previous_crops = frame, regions, crops
            count += 1
        if process.wait() != 0:
            raise RuntimeError('ffmpeg could not decode the visual track')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
    return signals, min(DURATION, count * step)


levels, signals, audio_seconds, expected_audio_seconds = audio_tracks()
try:
    visual, visual_seconds = visual_tracks() if '--video' in sys.argv else ([], 0)
    warnings = ['Visual reactions/cuts use two-second keyframe samples; brief reactions or cuts between samples may be missed. Region boxes describe the padded analysis proxy, not framing geometry.'] if '--video' in sys.argv else []
except Exception as error:
    visual, visual_seconds, warnings = [], 0, [f'Visual reactions unavailable: {error}']
print(json.dumps(dict(levels=levels, signals=signals+visual, audioSeconds=audio_seconds,
                      expectedAudioSeconds=expected_audio_seconds,
                      visualSeconds=visual_seconds, warnings=warnings), separators=(',', ':')))
