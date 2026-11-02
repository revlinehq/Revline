"""Pinned Beat This inference plus measured prominent hits and energy-rise candidates."""
import contextlib
import json
import os
import pathlib
import sys
import wave

threads = int(os.environ.get("BEAT_TRACK_THREADS", "2"))
if threads < 1 or threads > 8:
    raise ValueError("Beat tracking threads must be between 1 and 8")
os.environ.setdefault("OMP_NUM_THREADS", str(threads))
os.environ.setdefault("MKL_NUM_THREADS", str(threads))
import numpy as np
import torch
from beat_this.inference import Audio2Frames
from beat_this.model.postprocessor import Postprocessor

torch.set_num_threads(threads)
torch.set_num_interop_threads(1)


def strongest_spaced(events, spacing):
    selected = []
    for event in sorted(events, key=lambda item: item["strength"], reverse=True):
        if all(abs(event["time"] - kept["time"]) >= spacing for kept in selected):
            selected.append(event)
    return sorted(selected, key=lambda item: item["time"])


def dynamics(audio, rate):
    size, hop = 1024, round(rate / 100)
    count = max(0, (len(audio) - size) // hop + 1)
    novelty = np.zeros(count)
    window = np.hanning(size)
    frequencies = np.fft.rfftfreq(size, 1 / rate)
    weights = np.where((frequencies >= 30) & (frequencies < 250), 1.0,
                       np.where((frequencies >= 250) & (frequencies < 3500), 0.35, 0.0))
    previous = np.zeros(len(frequencies))
    for frame in range(count):
        spectrum = np.log1p(np.abs(np.fft.rfft(audio[frame * hop:frame * hop + size] * window)))
        novelty[frame] = np.maximum(0, spectrum - previous).dot(weights)
        previous = spectrum
    hits = []
    for frame in range(1, count - 1):
        local = novelty[max(0, frame - 50):min(count, frame + 51)]
        if novelty[frame] <= max(novelty[frame - 1], novelty[frame + 1], local.mean() + local.std() * 0.6):
            continue
        start = frame * hop
        peak = start + int(np.argmax(np.abs(audio[start:start + size])))
        hits.append({"time": round(peak / rate, 3), "strength": float(novelty[frame])})
    hits = strongest_spaced(hits, 0.18)
    if hits:
        reference = float(np.percentile([hit["strength"] for hit in hits], 90))
        hits = [{"time": hit["time"], "strength": round(min(1.0, hit["strength"] / reference), 3)}
                for hit in hits if hit["strength"] >= reference * 0.65]
    step = round(rate * 0.1)
    rms = np.array([np.sqrt(np.mean(audio[start:start + step] ** 2)) for start in range(0, len(audio), step)])
    maximum = float(rms.max()) if len(rms) else 0
    rises = []
    if maximum > 1e-4:
        for index in range(10, len(rms) - 10):
            before, after = float(rms[index - 10:index].mean()), float(rms[index:index + 10].mean())
            increase = after - before
            if after < maximum * 0.3 or increase < maximum * 0.2 or after < max(before * 2.0, 1e-4):
                continue
            rises.append({"time": round(index * step / rate, 3), "strength": round(min(1.0, increase / maximum), 3)})
    return hits, strongest_spaced(rises, 1.5)


with wave.open(sys.argv[1], "rb") as file:
    rate = file.getframerate()
    audio = np.frombuffer(file.readframes(file.getnframes()), dtype="<i2").astype(np.float32) / 32768

result = {"engine": "beat-this-final0-v1", "beats": [], "downbeats": [], "accents": [], "dropCandidates": [], "bpm": 0, "confidence": 0}
if len(audio) >= rate / 2 and float(np.mean(audio ** 2)) >= 1e-8:
    model = pathlib.Path(sys.argv[2])
    if not model.is_file():
        raise RuntimeError("Beat model is not installed")
    with contextlib.redirect_stdout(sys.stderr):
        tracker = Audio2Frames(checkpoint_path=str(model), device="cpu")
        beat_logits, downbeat_logits = tracker(audio, rate)
        beats, downbeats = Postprocessor(type="minimal")(beat_logits, downbeat_logits)
    beats = beats[(beats >= 0) & (beats < len(audio) / rate)]
    downbeats = downbeats[np.isin(downbeats, beats)]
    result["beats"] = [round(float(time), 3) for time in beats]
    result["downbeats"] = [round(float(time), 3) for time in downbeats]
    if len(beats):
        frames = torch.as_tensor(np.rint(beats * 50), dtype=torch.long).clamp(max=len(beat_logits) - 1)
        result["confidence"] = round(float(beat_logits.sigmoid()[frames].mean()), 3)
    if len(beats) > 2:
        result["bpm"] = round(float(60 / np.median(np.diff(beats))))
    result["accents"], result["dropCandidates"] = dynamics(audio, rate)
print(json.dumps(result, allow_nan=False))
