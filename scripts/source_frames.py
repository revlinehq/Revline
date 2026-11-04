"""Native source timestamps and bounded bidirectional decode for media-worker trackers."""
import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path

import cv2


class SourceFrames:
    """Disk-backed measured PTS, a streaming probe and a small reverse decode batch."""
    def __init__(self, path, request):
        self.request = request
        self.temp = tempfile.TemporaryDirectory(prefix='revline-track-')
        self.cache = sqlite3.connect(str(Path(self.temp.name)/'frames.sqlite'))
        self.cache.execute('create table frames (frame_index integer primary key, time real not null)')
        metadata = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
            'format=start_time:stream=avg_frame_rate,r_frame_rate', '-of', 'json', path]))
        self.origin = float(metadata.get('format', {}).get('start_time', 0))
        stream = metadata['streams'][0]
        def rate(value):
            a, b = value.split('/')
            return float(a)/float(b) if float(b) else 0.
        self.fps = rate(stream['avg_frame_rate']) or rate(stream['r_frame_rate'])
        self.probe = subprocess.Popen([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_frames',
            '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'compact=p=0:nk=0', path],
            stdout=subprocess.PIPE, text=True)
        self.capture = cv2.VideoCapture(path)
        ok, _ = self.capture.read()
        if not ok:
            self.close()
            raise ValueError('Could not decode the source video.')
        # Decoder builds can expose a container/audio timestamp offset (notably WebM).
        # Anchor their clock to the first measured video PTS, not an assumed zero.
        self.decoder_origin = self.capture.get(cv2.CAP_PROP_POS_MSEC)/1000
        self.frame_index, self.cursor = -1, 0
        self.video_origin, self.ended = None, False

    def next(self):
        if self.ended:
            return None
        for line in self.probe.stdout:
            value = next((part.split('=', 1)[1] for part in line.strip().split('|')
                          if part.startswith('best_effort_timestamp_time=')), None)
            if value is None:
                continue
            self.frame_index += 1
            time = float(value)-self.origin
            if self.video_origin is None:
                self.video_origin = time
            if time < self.request['start']-1e-6:
                continue
            if time >= self.request['end']-1e-6:
                self.ended = True
                return None
            self.cache.execute('insert into frames values (?, ?)', (self.frame_index, time))
            return self.frame_index, time
        self.ended = True
        if self.probe.wait() != 0:
            raise ValueError('Could not read source frame timestamps.')
        return None

    def at(self, index):
        saved = self.cache.execute('select frame_index,time from frames where frame_index=?', (index,)).fetchone()
        if saved:
            return saved
        return self.next()

    def seed(self):
        previous = None
        while True:
            current = self.next()
            if current is None:
                if previous is None:
                    raise ValueError('No source frame falls inside the requested window.')
                return previous
            if current[1] >= self.request['time']:
                return min([point for point in (previous, current) if point is not None],
                           key=lambda point: abs(point[1]-self.request['time']))
            previous = current

    def read(self, point):
        index, target = point
        if self.cursor == index-1:
            ok, image = self.capture.read()
            if ok and abs(self.capture.get(cv2.CAP_PROP_POS_MSEC)/1000+self.video_origin-self.decoder_origin-target) < .0002:
                self.cursor = index
                return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        # Seek before a measured PTS. Average-FPS frame arithmetic is unsafe on VFR.
        margin = .15
        while True:
            seek = max(0., target-self.video_origin-margin)
            self.capture.set(cv2.CAP_PROP_POS_MSEC, seek*1000)
            while True:
                ok, image = self.capture.read()
                if not ok:
                    break
                actual = self.capture.get(cv2.CAP_PROP_POS_MSEC)/1000+self.video_origin-self.decoder_origin
                if abs(actual-target) < .0002:
                    self.cursor = index
                    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                if actual > target+.0002:
                    break
            if seek == 0:
                raise ValueError('Decoder PTS did not match the source frame at '+str(target))
            margin *= 4

    def batches(self, seed, direction):
        index = seed[0]
        while True:
            if direction == -1:
                batch = self.cache.execute('select frame_index,time from frames where frame_index<? order by frame_index desc limit 12', (index,)).fetchall()
            else:
                batch = []
                for _ in range(12):
                    point = self.at(index+len(batch)+1)
                    if point is None:
                        break
                    batch.append(point)
            if not batch:
                return
            frames = {point[0]: self.read(point) for point in sorted(batch)}
            yield [(point, frames.pop(point[0])) for point in batch]
            index = batch[-1][0]

    def close(self):
        self.capture.release()
        if self.probe.poll() is None:
            self.probe.kill()
        self.probe.wait()
        self.probe.stdout.close()
        self.cache.close()
        self.temp.cleanup()
